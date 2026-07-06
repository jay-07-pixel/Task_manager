import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";
import { notifyAdminsDeadlineExtensionRequest } from "../services/deadlineExtensionNotificationService.js";

const router = Router();

export const POSTPONE_GRACE_MS = 24 * 60 * 60 * 1000;
const CRITICAL_OVERDUE_MIN_DAYS = 6;

function taskOverdueDayCount(dueAt) {
  if (!dueAt) return 0;
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const diffMs = Date.now() - due.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86_400_000);
}

function serializeExtensionRequest(row) {
  return {
    id: row.id,
    taskId: row.taskId,
    employeeUserId: row.employeeUserId,
    requestedAt: row.requestedAt?.toISOString?.() ?? row.requestedAt,
    status: row.status,
    approvedAt: row.approvedAt?.toISOString?.() ?? row.approvedAt ?? null,
    approvedByUserId: row.approvedByUserId ?? null,
    newDueAt: row.newDueAt?.toISOString?.() ?? row.newDueAt ?? null,
    expiresAt: row.requestedAt
      ? new Date(new Date(row.requestedAt).getTime() + POSTPONE_GRACE_MS).toISOString()
      : null,
    employee: row.employee
      ? { id: row.employee.id, displayName: row.employee.displayName, email: row.employee.email }
      : null,
    task: row.task
      ? {
          id: row.task.id,
          title: row.task.title,
          dueAt: row.task.dueAt?.toISOString?.() ?? null,
          listId: row.task.listId,
        }
      : null,
  };
}

async function assertEmployeeCriticalOverdueTask(taskId, userId) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      assignments: { some: { userId, assigneeDone: false } },
    },
    include: {
      assignments: { where: { userId }, select: { assigneeDone: true } },
    },
  });
  if (!task) {
    return { error: "Task not found or not assigned to you", status: 404 };
  }
  if (!task.dueAt || taskOverdueDayCount(task.dueAt) < CRITICAL_OVERDUE_MIN_DAYS) {
    return { error: "This task is not critically overdue", status: 400 };
  }
  return { task };
}

const approveSchema = z.object({
  newDueAt: z.string().min(1),
});

const postponeSchema = z.object({
  taskId: z.string().uuid(),
});

/** Employee: request deadline extension (postpone). */
router.post("/", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }

  const parsed = postponeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const userId = req.session.userId;
  const { taskId } = parsed.data;
  const check = await assertEmployeeCriticalOverdueTask(taskId, userId);
  if (check.error) {
    return res.status(check.status).json({ error: check.error });
  }
  const { task } = check;

  const employee = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });

  let request = await prisma.taskDeadlineExtensionRequest.findFirst({
    where: { taskId, employeeUserId: userId, status: "pending" },
    orderBy: { requestedAt: "desc" },
  });

  const now = new Date();
  let notify = false;

  if (request) {
    const ageMs = now.getTime() - new Date(request.requestedAt).getTime();
    if (ageMs < POSTPONE_GRACE_MS) {
      return res.json({ request: serializeExtensionRequest(request) });
    }
    request = await prisma.taskDeadlineExtensionRequest.update({
      where: { id: request.id },
      data: { requestedAt: now },
    });
    notify = true;
  } else {
    request = await prisma.taskDeadlineExtensionRequest.create({
      data: { taskId, employeeUserId: userId },
    });
    notify = true;
  }

  if (notify) {
    void notifyAdminsDeadlineExtensionRequest({
      employeeId: userId,
      employeeName: employee?.displayName || "Employee",
      taskId: task.id,
      taskTitle: task.title,
      overdueDays: taskOverdueDayCount(task.dueAt),
      requestId: request.id,
    }).catch((err) => console.error("[deadline-ext]", err));
  }

  res.status(201).json({ request: serializeExtensionRequest(request) });
});

/** Admin: list pending extension requests. */
router.get("/", requireOwner, async (_req, res) => {
  const rows = await prisma.taskDeadlineExtensionRequest.findMany({
    where: { status: "pending" },
    include: {
      employee: { select: { id: true, displayName: true, email: true } },
      task: { select: { id: true, title: true, dueAt: true, listId: true } },
    },
    orderBy: { requestedAt: "asc" },
  });
  res.json({ requests: rows.map(serializeExtensionRequest) });
});

/** Admin: approve request and set new deadline. */
router.post("/:id/approve", requireOwner, async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A new deadline date is required" });
  }

  const newDueAt = new Date(parsed.data.newDueAt);
  if (Number.isNaN(newDueAt.getTime())) {
    return res.status(400).json({ error: "Invalid deadline date" });
  }

  const request = await prisma.taskDeadlineExtensionRequest.findUnique({
    where: { id: req.params.id },
    include: {
      task: { include: { list: { select: { ownerId: true } } } },
      employee: { select: { id: true, displayName: true } },
    },
  });

  if (!request || request.status !== "pending") {
    return res.status(404).json({ error: "Request not found or already handled" });
  }

  const now = new Date();
  const [updatedRequest] = await prisma.$transaction([
    prisma.taskDeadlineExtensionRequest.update({
      where: { id: request.id },
      data: {
        status: "approved",
        approvedAt: now,
        approvedByUserId: req.session.userId,
        newDueAt,
      },
    }),
    prisma.task.update({
      where: { id: request.taskId },
      data: { dueAt: newDueAt },
    }),
  ]);

  const full = await prisma.taskDeadlineExtensionRequest.findUnique({
    where: { id: updatedRequest.id },
    include: {
      employee: { select: { id: true, displayName: true, email: true } },
      task: { select: { id: true, title: true, dueAt: true, listId: true } },
    },
  });

  res.json({ request: serializeExtensionRequest(full) });
});

/** Attach pending extension to employee tasks (used by /assigned). */
export async function attachPendingDeadlineExtensions(tasks, employeeUserId) {
  if (!tasks.length || !employeeUserId) return tasks;
  const taskIds = tasks.map((t) => t.id);
  const pending = await prisma.taskDeadlineExtensionRequest.findMany({
    where: {
      taskId: { in: taskIds },
      employeeUserId,
      status: "pending",
    },
    orderBy: { requestedAt: "desc" },
  });
  const byTask = new Map();
  const now = Date.now();
  for (const row of pending) {
    if (now >= row.requestedAt.getTime() + POSTPONE_GRACE_MS) continue;
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, row);
  }
  return tasks.map((t) => ({
    ...t,
    pendingDeadlineExtension: byTask.has(t.id)
      ? {
          id: byTask.get(t.id).id,
          requestedAt: byTask.get(t.id).requestedAt.toISOString(),
          status: byTask.get(t.id).status,
          expiresAt: new Date(
            byTask.get(t.id).requestedAt.getTime() + POSTPONE_GRACE_MS
          ).toISOString(),
        }
      : null,
  }));
}

export default router;
