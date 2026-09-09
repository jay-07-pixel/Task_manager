import { prisma } from "../lib/prisma.js";
import { sendTaskAssignedEmail, sendTaskUpdatedEmail } from "../lib/mail.js";
import { isCompanyTaskAssignmentEmailEnabled } from "./companyAttendanceSettings.js";

const LOG = "[task-assignment-email]";

function dueAtMs(value) {
  if (value == null || value === "") return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function recurrenceRuleChanged(previous, patch) {
  if (patch.recurrenceRule === undefined) return false;
  const prevRaw = previous.recurrenceRule ?? null;
  if (patch.recurrenceRule === null) return prevRaw != null;
  let prevObj = null;
  try {
    prevObj = prevRaw ? JSON.parse(prevRaw) : null;
  } catch {
    return true;
  }
  const strip = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    const { occurrencesCompleted: _ignored, ...rest } = obj;
    return rest;
  };
  try {
    return JSON.stringify(strip(prevObj)) !== JSON.stringify(strip(patch.recurrenceRule));
  } catch {
    return true;
  }
}

/**
 * True when the owner changed assignment-relevant fields (not just save with the same form).
 * @param {any} previous
 * @param {any} patch
 */
export function taskAssignmentContentChanged(previous, patch) {
  if (!previous || !patch) return false;
  if (patch.title != null && patch.title.trim() !== String(previous.title ?? "").trim()) {
    return true;
  }
  if (patch.notes != null && String(patch.notes) !== String(previous.notes ?? "")) {
    return true;
  }
  if (patch.dueAt !== undefined && dueAtMs(patch.dueAt) !== dueAtMs(previous.dueAt)) {
    return true;
  }
  if (
    patch.dueTimeZone !== undefined &&
    patch.dueAt === undefined &&
    (patch.dueTimeZone?.trim() || null) !== (previous.dueTimeZone || null)
  ) {
    return true;
  }
  if (patch.allDay !== undefined && !!patch.allDay !== !!previous.allDay) {
    return true;
  }
  if (patch.recurrence !== undefined && patch.recurrence !== previous.recurrence) {
    return true;
  }
  if (recurrenceRuleChanged(previous, patch)) {
    return true;
  }
  if (
    patch.durationMinutes !== undefined &&
    patch.durationMinutes !== previous.durationMinutes
  ) {
    return true;
  }
  return false;
}

async function loadAdmin(actorUserId) {
  if (!actorUserId) {
    return { displayName: "An administrator", email: "" };
  }
  const admin = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { displayName: true, email: true },
  });
  return {
    displayName: admin?.displayName?.trim() || "An administrator",
    email: admin?.email?.trim() || "",
  };
}

async function loadRecipients(userIds, actorUserId) {
  const unique = [...new Set((userIds ?? []).filter(Boolean))];
  if (!unique.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, role: "employee" },
    select: { id: true, email: true, displayName: true },
  });
  return users.filter((u) => u.id !== actorUserId && u.email?.trim());
}

function assignmentUserIds(task) {
  return (task?.assignments ?? []).map((a) => a.userId).filter(Boolean);
}

/**
 * @param {{ kind: "assigned" | "updated", userIds: string[], task: any, actorUserId: string }} params
 */
async function sendToAssignees({ kind, userIds, task, actorUserId }) {
  const recipients = await loadRecipients(userIds, actorUserId);
  if (!recipients.length) return;
  const admin = await loadAdmin(actorUserId);
  const send = kind === "assigned" ? sendTaskAssignedEmail : sendTaskUpdatedEmail;
  await Promise.allSettled(
    recipients.map((user) =>
      send({
        to: user.email.trim(),
        recipientName: user.displayName,
        admin,
        task: {
          title: task.title,
          notes: task.notes,
          dueAt: task.dueAt,
          allDay: task.allDay,
        },
      }).catch((err) => {
        console.error(`${LOG} ${kind} failed userId=${user.id}`, err);
      })
    )
  );
}

/**
 * Fire-and-forget emails after an owner creates a task with assignees.
 * @param {{ task: any, actorUserId: string }} params
 */
export function notifyAssigneesAfterTaskCreate({ task, actorUserId }) {
  void (async () => {
    if (!(await isCompanyTaskAssignmentEmailEnabled())) return;
    await sendToAssignees({
      kind: "assigned",
      userIds: assignmentUserIds(task),
      task,
      actorUserId,
    });
  })().catch((err) => console.error(LOG, err));
}

/**
 * Fire-and-forget emails after an owner edits a task.
 * Newly added assignees get an assignment email; remaining assignees get an update email if the task content changed.
 * @param {{ previous: any, updated: any, patch: any, actorUserId: string }} params
 */
export function notifyAssigneesAfterTaskUpdate({ previous, updated, patch, actorUserId }) {
  void (async () => {
    if (!(await isCompanyTaskAssignmentEmailEnabled())) return;
    const prevIds = new Set(assignmentUserIds(previous));
    const nextIds = assignmentUserIds(updated);
    const newlyAssigned = nextIds.filter((id) => !prevIds.has(id));
    const remaining = nextIds.filter((id) => prevIds.has(id));
    const contentChanged = taskAssignmentContentChanged(previous, patch);

    if (newlyAssigned.length) {
      await sendToAssignees({
        kind: "assigned",
        userIds: newlyAssigned,
        task: updated,
        actorUserId,
      });
    }
    if (contentChanged && remaining.length) {
      await sendToAssignees({
        kind: "updated",
        userIds: remaining,
        task: updated,
        actorUserId,
      });
    }
  })().catch((err) => console.error(LOG, err));
}
