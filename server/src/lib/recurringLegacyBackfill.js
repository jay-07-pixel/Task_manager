import { prisma } from "./prisma.js";
import {
  computePreviousDueAt,
  findExistingSeriesOccurrence,
  shouldRollOnEmployeeComplete,
} from "./recurrenceRoll.js";

function assigneeHasSubmissionContent(row) {
  if (!row) return false;
  const text = (row.submissionText ?? "").trim();
  const proofCount = (row.submissionProofs ?? []).filter((p) => !p.archived).length;
  return text.length > 0 || !!row.completionProofPath || proofCount > 0;
}

/**
 * Old in-place roll only: archived submission on last_* fields, current row not done.
 * Do NOT treat "all assignees submitted, awaiting owner Mark as reviewed" as legacy —
 * that modern state was spawning duplicate past-due cards on every restart.
 */
function isLegacyRolledAssignee(row) {
  if (!row || row.assigneeDone) return false;
  if (!row.lastSubmittedAt) return false;
  if (assigneeHasSubmissionContent(row)) return false;
  return !!((row.lastSubmissionText ?? "").trim() || row.lastCompletionProofPath);
}

async function createCompletedOccurrenceTask(activeTask, prevDue, assigneeRows) {
  const maxOrder = await prisma.task.aggregate({
    where: { listId: activeTask.listId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  const assigneeCreates = assigneeRows.map((a) => {
    const text = (a.lastSubmissionText ?? "").trim() || null;
    const proof = a.lastCompletionProofPath;
    return {
      userId: a.userId,
      assignedByUserId: a.assignedByUserId ?? null,
      delegatedAt: a.delegatedAt ?? null,
      assigneeDone: true,
      lastSubmittedAt: a.lastSubmittedAt ?? new Date(),
      submissionText: text,
      completionProofPath: proof,
    };
  });

  return prisma.task.create({
    data: {
      listId: activeTask.listId,
      createdById: activeTask.createdById,
      title: activeTask.title,
      notes: activeTask.notes,
      dueAt: prevDue,
      dueTimeZone: activeTask.dueTimeZone,
      allDay: activeTask.allDay,
      recurrence: activeTask.recurrence,
      recurrenceRule: activeTask.recurrenceRule,
      completed: true,
      starred: activeTask.starred,
      highPriority: activeTask.highPriority,
      durationMinutes: activeTask.durationMinutes,
      sortOrder,
      assignments: { create: assigneeCreates },
    },
  });
}

async function clearActiveOccurrenceAssignee(taskId, userId) {
  await prisma.taskAssignee.update({
    where: { taskId_userId: { taskId, userId } },
    data: {
      assigneeDone: false,
      submissionText: null,
      completionProofPath: null,
      lastSubmittedAt: null,
      lastSubmissionText: null,
      lastCompletionProofPath: null,
    },
  });
}

/**
 * Split a pre-change recurring task (one id rolled in place) into:
 * - new completed card for the submitted occurrence
 * - existing id stays as the open next occurrence
 */
export async function reconcileLegacyRolledRecurringTask(task) {
  if (!task?.recurrence || task.recurrence === "none" || task.completed) return false;
  if (!shouldRollOnEmployeeComplete(task.recurrence, task.recurrenceRule)) return false;

  // Never split modern "submitted awaiting owner review" (all assignees done on current fields).
  if ((task.assignments ?? []).length > 0 && (task.assignments ?? []).every((a) => a.assigneeDone)) {
    return false;
  }

  const rolled = (task.assignments ?? []).filter(isLegacyRolledAssignee);
  if (!rolled.length) return false;

  const prevDue = computePreviousDueAt(
    task.dueAt,
    task.recurrence,
    task.allDay,
    task.recurrenceRule
  );
  if (!prevDue) return false;

  // Avoid creating a second card for a due day that already exists in this series.
  const already = await findExistingSeriesOccurrence(prisma, {
    listId: task.listId,
    title: task.title,
    recurrence: task.recurrence,
    dueAt: prevDue,
    excludeTaskId: task.id,
  });
  if (already) return false;

  await createCompletedOccurrenceTask(task, prevDue, rolled);

  for (const a of rolled) {
    await clearActiveOccurrenceAssignee(task.id, a.userId);
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { completed: false },
  });

  return true;
}

/** Run once on startup (and via script) for tasks created before spawn-per-occurrence. */
export async function reconcileAllLegacyRolledRecurringTasks() {
  const tasks = await prisma.task.findMany({
    where: {
      completed: false,
      recurrence: { not: "none" },
    },
    include: {
      assignments: {
        include: { submissionProofs: { select: { archived: true } } },
      },
    },
  });

  let count = 0;
  for (const task of tasks) {
    try {
      if (await reconcileLegacyRolledRecurringTask(task)) count += 1;
    } catch (err) {
      console.error(`[recurring-backfill] task ${task.id}:`, err);
    }
  }
  return count;
}
