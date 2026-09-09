import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { isCompanyTaskAssignmentEmailEnabled } from "./companyAttendanceSettings.js";
import { sendWorkTransferredEmail } from "../lib/mail.js";

const LOG = "[task-work-transfer]";
const proofsRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
  "completion-proofs"
);

function unlinkProof(storedName) {
  if (!storedName || /[\\/]/.test(storedName)) return;
  fs.unlink(path.join(proofsRoot, path.basename(storedName)), () => {});
}

function openAssignmentWhere(fromUserId) {
  return {
    userId: fromUserId,
    assigneeDone: false,
    task: { completed: false },
  };
}

/**
 * @param {string} fromUserId
 */
export async function getTransferPreview(fromUserId) {
  const from = await prisma.user.findUnique({
    where: { id: fromUserId },
    select: { id: true, email: true, displayName: true },
  });
  if (!from) return null;

  const [openCount, submittedCount, users] = await Promise.all([
    prisma.taskAssignee.count({ where: openAssignmentWhere(fromUserId) }),
    prisma.taskAssignee.count({
      where: {
        userId: fromUserId,
        assigneeDone: true,
        task: { completed: false },
      },
    }),
    prisma.user.findMany({
      where: { id: { not: fromUserId } },
      select: { id: true, email: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  return { from, openCount, submittedCount, users };
}

/**
 * Move pending (not submitted, not reviewed) assignments from one employee to another.
 * Submitted work stays on the leaving employee until an admin reviews it.
 *
 * @param {{ fromUserId: string, toUserId: string, actorUserId: string }} params
 */
export async function transferOpenWork({ fromUserId, toUserId, actorUserId }) {
  if (!fromUserId || !toUserId) {
    throw Object.assign(new Error("Choose an employee to receive the work."), { status: 400 });
  }
  if (fromUserId === toUserId) {
    throw Object.assign(new Error("Choose a different employee."), { status: 400 });
  }

  const [from, to] = await Promise.all([
    prisma.user.findUnique({
      where: { id: fromUserId },
      select: { id: true, email: true, displayName: true },
    }),
    prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, email: true, displayName: true, role: true },
    }),
  ]);
  if (!from) {
    throw Object.assign(new Error("Employee not found."), { status: 404 });
  }
  if (!to) {
    throw Object.assign(new Error("Replacement employee not found."), { status: 404 });
  }

  const open = await prisma.taskAssignee.findMany({
    where: openAssignmentWhere(fromUserId),
    select: {
      taskId: true,
      completionProofPath: true,
      lastCompletionProofPath: true,
      task: { select: { id: true, title: true } },
      submissionProofs: { select: { filePath: true } },
    },
  });

  const submittedKept = await prisma.taskAssignee.count({
    where: {
      userId: fromUserId,
      assigneeDone: true,
      task: { completed: false },
    },
  });

  if (!open.length) {
    return {
      transferred: 0,
      alreadyAssigned: 0,
      submittedKept,
      from,
      to,
      titles: [],
    };
  }

  const taskIds = open.map((row) => row.taskId);
  const existing = await prisma.taskAssignee.findMany({
    where: { userId: toUserId, taskId: { in: taskIds } },
    select: { taskId: true },
  });
  const alreadyOnTask = new Set(existing.map((row) => row.taskId));
  const toCreate = open.filter((row) => !alreadyOnTask.has(row.taskId));
  const proofPaths = [];
  for (const row of open) {
    if (row.completionProofPath) proofPaths.push(row.completionProofPath);
    if (row.lastCompletionProofPath) proofPaths.push(row.lastCompletionProofPath);
    for (const p of row.submissionProofs ?? []) {
      if (p.filePath) proofPaths.push(p.filePath);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (toCreate.length) {
      await tx.taskAssignee.createMany({
        data: toCreate.map((row) => ({
          taskId: row.taskId,
          userId: toUserId,
          assignedByUserId: actorUserId,
        })),
      });
    }
    await tx.taskDeadlineExtensionRequest.updateMany({
      where: {
        employeeUserId: fromUserId,
        taskId: { in: taskIds },
        status: "pending",
      },
      data: { status: "cancelled" },
    });
    await tx.taskAssignee.deleteMany({
      where: {
        userId: fromUserId,
        taskId: { in: taskIds },
        assigneeDone: false,
      },
    });
  });

  for (const stored of proofPaths) unlinkProof(stored);

  const titles = toCreate.map((row) => row.task?.title).filter(Boolean);
  notifyReplacement({ to, from, actorUserId, titles }).catch((err) => console.error(LOG, err));

  return {
    transferred: toCreate.length,
    alreadyAssigned: open.length - toCreate.length,
    submittedKept,
    from,
    to,
    titles,
  };
}

async function notifyReplacement({ to, from, actorUserId, titles }) {
  if (!titles.length) return;
  if (!(await isCompanyTaskAssignmentEmailEnabled())) return;
  const email = to.email?.trim();
  if (!email) return;
  const admin = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { displayName: true, email: true },
  });
  await sendWorkTransferredEmail({
    to: email,
    recipientName: to.displayName,
    admin: {
      displayName: admin?.displayName || "An administrator",
      email: admin?.email || "",
    },
    previousName: from.displayName,
    titles,
  });
}
