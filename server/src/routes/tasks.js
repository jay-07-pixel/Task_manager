import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  bumpedRecurrenceRuleJson,
  computeNextDueAt,
  recurrenceEndsAfterThisCompletion,
  recurrenceNextDueExceedsEndOn,
  shouldRollOnEmployeeComplete,
} from "../lib/recurrenceRoll.js";
import { requireAuth, requireOwner } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, "..", "..", "uploads", "completion-proofs");
fs.mkdirSync(uploadsRoot, { recursive: true });

const router = Router();

const SUBMISSION_TEXT_MAX = 2000;
const SUBMISSION_REQUIRED_MSG = "Please provide submission text or upload an image.";
const PROGRESS_UPDATE_TEXT_MAX = 2000;

const progressUpdateTypeSchema = z.enum(["started", "in_progress", "blocked", "update"]);
const progressUpdateBodySchema = z.object({
  updateType: progressUpdateTypeSchema,
  message: z.string().trim().min(1).max(PROGRESS_UPDATE_TEXT_MAX),
});

/** @param {{ submissionText?: string | null, completionProofPath?: string | null } | null | undefined} row */
function assigneeHasSubmissionContent(row) {
  if (!row) return false;
  const text = (row.submissionText ?? "").trim();
  return text.length > 0 || !!row.completionProofPath;
}

/** @param {{ completionProofPath?: string | null }} row */
function clearAssigneeSubmissionUpdate(assigneeDone) {
  return {
    assigneeDone,
    completionProofPath: null,
    submissionText: null,
  };
}

const taskAssigneeInclude = {
  assignments: {
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      assignedBy: { select: { id: true, displayName: true } },
    },
  },
};

const delegateTaskSchema = z.object({
  employeeId: z.string().uuid(),
});

const employeeCreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).optional(),
  dueAt: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  allDay: z.boolean().optional(),
  assigneeId: z.string().uuid(),
});

const taskListSelect = { list: { select: { id: true, title: true } } };

async function endRecurrenceSeries(taskId) {
  await prisma.task.update({
    where: { id: taskId },
    data: { recurrence: "none", recurrenceRule: null },
  });
}

async function maybeRollRecurringAfterEmployeeComplete(task, userId) {
  if (!shouldRollOnEmployeeComplete(task.recurrence, task.recurrenceRule)) return;

  if (recurrenceEndsAfterThisCompletion(task.recurrence, task.recurrenceRule)) {
    await endRecurrenceSeries(task.id);
    return;
  }

  const nextDue = computeNextDueAt(task.dueAt, task.recurrence, task.allDay, task.recurrenceRule);
  if (!nextDue) return;

  if (recurrenceNextDueExceedsEndOn(nextDue, task.recurrenceRule)) {
    await endRecurrenceSeries(task.id);
    return;
  }

  const row = task.assignments.find((a) => a.userId === userId);
  if (row?.completionProofPath) {
    deleteProofFile(row.completionProofPath);
  }

  const updateData = { dueAt: nextDue, completed: false };
  if (task.recurrence === "custom" && task.recurrenceRule) {
    updateData.recurrenceRule = bumpedRecurrenceRuleJson(task.recurrenceRule);
  }

  await prisma.task.update({
    where: { id: task.id },
    data: updateData,
  });
  await prisma.taskAssignee.update({
    where: { taskId_userId: { taskId: task.id, userId } },
    data: clearAssigneeSubmissionUpdate(false),
  });
  await syncTaskCompletedFromAssignments(task.id);
}

async function resolveEmployeeIds(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const employees = await prisma.user.findMany({
    where: { id: { in: unique }, role: "employee" },
    select: { id: true },
  });
  const ok = new Set(employees.map((e) => e.id));
  return unique.filter((id) => ok.has(id));
}

function taskIsAssignedToUser(task, userId) {
  return (task.assignments ?? []).some((a) => a.userId === userId);
}

const recurrenceRuleSchema = z
  .object({
    every: z.number().int().min(1).max(999),
    unit: z.enum(["day", "week", "month", "year"]),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    startDate: z.string().min(1).optional(),
    endType: z.enum(["never", "on", "after"]),
    endOn: z.string().min(1).nullable().optional(),
    endAfterOccurrences: z.number().int().min(1).max(9999).nullable().optional(),
    occurrencesCompleted: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.endType === "on") {
      if (r.endOn == null || String(r.endOn).trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endOn is required when endType is on", path: ["endOn"] });
      }
    }
    if (r.endType === "after") {
      if (r.endAfterOccurrences == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "endAfterOccurrences is required when endType is after",
          path: ["endAfterOccurrences"],
        });
      }
    }
  });

function parseRecurrenceRule(raw) {
  if (raw == null || raw === "") return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return recurrenceRuleSchema.parse(o);
  } catch {
    return null;
  }
}

/** @param {string | null | undefined} storedName */
function deleteProofFile(storedName) {
  if (!storedName || /[\\/]/.test(storedName)) return;
  const full = path.join(uploadsRoot, path.basename(storedName));
  fs.unlink(full, () => {});
}

function proofAbsolutePath(storedName) {
  if (!storedName || /[\\/]/.test(storedName)) return null;
  const full = path.join(uploadsRoot, path.basename(storedName));
  return fs.existsSync(full) ? full : null;
}

function proofContentType(storedName) {
  const ext = path.extname(storedName).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

/** @param {unknown} err */
function submissionServerErrorMessage(err) {
  const msg = String(err && typeof err === "object" && "message" in err ? err.message : err || "");
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  if (
    code === "P2022" ||
    /Unknown column|submission_text/i.test(msg) ||
    /column.*does not exist/i.test(msg)
  ) {
    return "Database migration required. On the server run: cd server && npx prisma migrate deploy && npm run db:generate";
  }
  if (/ENOENT|EACCES|EPERM/i.test(msg)) {
    return "Server could not save the upload. Check uploads/completion-proofs permissions on the server.";
  }
  return null;
}

const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsRoot);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
      const uid = req.session?.userId || "anon";
      cb(null, `${req.params.id}-${uid}-${randomUUID()}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed"));
  },
});

function readSubmissionTextFromBody(req) {
  const body = req.body ?? {};
  if (typeof body.submissionText === "string") return body.submissionText;
  if (typeof body.submission_text === "string") return body.submission_text;
  return "";
}

/** @param {import("express").Request} req */
function getProofUploadFile(req) {
  if (req.file) return req.file;
  const files = req.files;
  if (!files) return null;
  if (Array.isArray(files)) {
    return files.find((f) => f.fieldname === "proof") ?? null;
  }
  return files.proof?.[0] ?? null;
}

function handleProofUpload(req, res, next) {
  proofUpload.fields([{ name: "proof", maxCount: 1 }])(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image must be 5 MB or smaller." });
    }
    const msg = err.message || "Upload failed";
    if (/Only JPEG|images are allowed/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    return next(err);
  });
}

async function syncTaskCompletedFromAssignments(taskId) {
  const rows = await prisma.taskAssignee.findMany({
    where: { taskId },
    select: { assigneeDone: true },
  });
  if (rows.length === 0) return;
  const allDone = rows.every((r) => r.assigneeDone);
  await prisma.task.update({
    where: { id: taskId },
    data: { completed: allDone },
  });
}

async function attachProgressUpdateMeta(tasks, ownerId = null) {
  if (!tasks.length) return tasks;
  const taskIds = tasks.map((t) => t.id);
  const countRows = await prisma.taskProgressUpdate.groupBy({
    by: ["taskId", "userId"],
    where: { taskId: { in: taskIds } },
    _count: { _all: true },
  });
  const countMap = new Map(countRows.map((r) => [`${r.taskId}:${r.userId}`, r._count._all]));

  const latestMap = new Map();
  const latestRows = await prisma.taskProgressUpdate.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: [{ createdAt: "desc" }],
    select: {
      taskId: true,
      userId: true,
      message: true,
      updateType: true,
      createdAt: true,
    },
  });
  for (const row of latestRows) {
    const key = `${row.taskId}:${row.userId}`;
    if (!latestMap.has(key)) latestMap.set(key, row);
  }

  const unreadMap = new Map();
  if (ownerId) {
    const readRows = await prisma.taskProgressUpdateRead.findMany({
      where: { ownerId, taskId: { in: taskIds } },
    });
    const readMap = new Map(
      readRows.map((r) => [`${r.taskId}:${r.assigneeUserId}`, r.lastReadAt])
    );
    const updates = await prisma.taskProgressUpdate.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, userId: true, createdAt: true },
    });
    for (const u of updates) {
      const key = `${u.taskId}:${u.userId}`;
      const lastRead = readMap.get(key);
      if (!lastRead || u.createdAt > lastRead) {
        unreadMap.set(key, (unreadMap.get(key) ?? 0) + 1);
      }
    }
  }

  return tasks.map((t) => ({
    ...t,
    assignments: (t.assignments ?? []).map((a) => {
      const latest = latestMap.get(`${t.id}:${a.userId}`) ?? null;
      return {
        ...a,
        progressUpdateCount: countMap.get(`${t.id}:${a.userId}`) ?? 0,
        unreadProgressUpdateCount: ownerId ? (unreadMap.get(`${t.id}:${a.userId}`) ?? 0) : 0,
        latestProgressUpdate: latest
          ? {
              message: latest.message,
              updateType: latest.updateType,
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
      };
    }),
  }));
}

function serializeProgressUpdate(row) {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.user?.displayName ?? "",
    updateType: row.updateType,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeDelegation(row) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    fromUserName: row.fromUser?.displayName ?? "",
    toUserId: row.toUserId,
    toUserName: row.toUser?.displayName ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

async function attachDelegationsToTasks(tasks) {
  if (!tasks.length) return tasks;
  const taskIds = tasks.map((t) => t.id);
  const rows = await prisma.taskDelegation.findMany({
    where: { taskId: { in: taskIds } },
    include: {
      fromUser: { select: { id: true, displayName: true } },
      toUser: { select: { id: true, displayName: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.taskId) ?? [];
    list.push(row);
    map.set(row.taskId, list);
  }
  return tasks.map((t) => ({
    ...t,
    delegations: map.get(t.id) ?? [],
  }));
}

export function serializeTask(t) {
  let recurrenceRule = null;
  if (t.recurrenceRule) {
    try {
      recurrenceRule = JSON.parse(t.recurrenceRule);
    } catch {
      recurrenceRule = null;
    }
  }
  const assignees = (t.assignments ?? []).map((a) => ({
    id: a.user.id,
    displayName: a.user.displayName,
    email: a.user.email,
    assigneeDone: a.assigneeDone,
    submissionText: (a.submissionText ?? "").trim() || null,
    completionProofUrl: a.completionProofPath
      ? `/api/tasks/${t.id}/completion-proof/${a.userId}`
      : null,
    progressUpdateCount: a.progressUpdateCount ?? 0,
    unreadProgressUpdateCount: a.unreadProgressUpdateCount ?? 0,
    latestProgressUpdate: a.latestProgressUpdate ?? null,
    assignedBy: a.assignedBy
      ? { id: a.assignedBy.id, displayName: a.assignedBy.displayName }
      : null,
    delegatedAt: a.delegatedAt instanceof Date ? a.delegatedAt.toISOString() : (a.delegatedAt ?? null),
  }));
  const delegations = (t.delegations ?? []).map(serializeDelegation);
  return {
    id: t.id,
    listId: t.listId,
    list: t.list ? { id: t.list.id, title: t.list.title } : null,
    assignees,
    delegations,
    title: t.title,
    notes: t.notes,
    dueAt: t.dueAt?.toISOString() ?? null,
    dueTimeZone: t.dueTimeZone ?? null,
    allDay: t.allDay,
    recurrence: t.recurrence,
    recurrenceRule,
    completed: t.completed,
    starred: t.starred,
    sortOrder: t.sortOrder,
  };
}

async function assertListOwner(listId, userId) {
  return prisma.taskList.findFirst({
    where: { id: listId, ownerId: userId },
  });
}

/** First owner account's default task list (for employee-created tasks visible to admin). */
async function resolveOwnerDefaultList() {
  const owner = await prisma.user.findFirst({
    where: { role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) return null;

  let list = await prisma.taskList.findFirst({
    where: { ownerId: owner.id },
    orderBy: { sortOrder: "asc" },
  });
  if (!list) {
    list = await prisma.taskList.create({
      data: { ownerId: owner.id, title: "Tasks", sortOrder: 0 },
    });
  }
  return { list, ownerId: owner.id };
}

router.get("/assigned", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const tasks = await attachProgressUpdateMeta(
    await prisma.task.findMany({
      where: { assignments: { some: { userId: req.session.userId } } },
      include: { ...taskAssigneeInclude, list: { select: { id: true, title: true } } },
      orderBy: [{ sortOrder: "asc" }],
    })
  );
  res.json({ tasks: tasks.map(serializeTask) });
});

router.post("/employee-create", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }

  const parsed = employeeCreateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { title, notes, dueAt, allDay, assigneeId } = parsed.data;
  if (assigneeId === req.session.userId) {
    return res.status(400).json({ error: "Assign the task to another employee, not yourself" });
  }

  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, role: "employee" },
    select: { id: true },
  });
  if (!assignee) {
    return res.status(400).json({ error: "Invalid employee" });
  }

  const ownerCtx = await resolveOwnerDefaultList();
  if (!ownerCtx) {
    return res.status(503).json({ error: "No admin account is set up yet" });
  }

  const maxOrder = await prisma.task.aggregate({
    where: { listId: ownerCtx.list.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  let dueAtDate = null;
  if (dueAt && String(dueAt).length > 0) {
    dueAtDate = new Date(dueAt);
    if (Number.isNaN(dueAtDate.getTime())) {
      return res.status(400).json({ error: "Invalid due date" });
    }
  }

  const now = new Date();
  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        listId: ownerCtx.list.id,
        createdById: req.session.userId,
        title: title.trim(),
        notes: notes?.trim() ?? "",
        dueAt: dueAtDate,
        allDay: allDay ?? false,
        sortOrder,
        assignments: {
          create: {
            userId: assigneeId,
            assignedByUserId: req.session.userId,
            delegatedAt: now,
          },
        },
      },
      include: taskAssigneeInclude,
    });
    await tx.taskDelegation.create({
      data: {
        taskId: created.id,
        fromUserId: req.session.userId,
        toUserId: assigneeId,
      },
    });
    return created;
  });

  const withMeta = (await attachProgressUpdateMeta([task]))[0];
  const withDelegations = (await attachDelegationsToTasks([withMeta]))[0];
  res.status(201).json({ task: serializeTask(withDelegations) });
});

router.get("/lists/:listId", requireOwner, async (req, res) => {
  const list = await assertListOwner(req.params.listId, req.session.userId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const roots = await attachDelegationsToTasks(
    await attachProgressUpdateMeta(
      await prisma.task.findMany({
        where: { listId: list.id },
        include: taskAssigneeInclude,
        orderBy: [{ completed: "asc" }, { sortOrder: "asc" }],
      }),
      req.session.userId
    )
  );
  res.json({ tasks: roots.map(serializeTask) });
});

/** Must be before /:id PATCH so "completion-proof" is not captured as id */
router.get("/:id/progress-updates", requireAuth, async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: {
      list: true,
      assignments: { include: { user: { select: { id: true, displayName: true } } } },
    },
  });
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const isOwner = task.list.ownerId === req.session.userId;
  const isAssignee =
    req.session.role === "employee" && taskIsAssignedToUser(task, req.session.userId);

  const assigneeUserId =
    req.session.role === "employee"
      ? req.session.userId
      : typeof req.query.assigneeUserId === "string"
        ? req.query.assigneeUserId
        : null;

  if (!isOwner && !isAssignee) {
    return res.status(403).json({ error: "Not allowed" });
  }

  const allUpdates = isOwner && req.query.all === "1";

  if (isOwner && !assigneeUserId && !allUpdates) {
    return res.status(400).json({
      error: "assigneeUserId query parameter is required, or pass all=1 for full history",
    });
  }

  if (!allUpdates && !task.assignments.some((a) => a.userId === assigneeUserId)) {
    return res.status(404).json({ error: "Assignee not found on this task" });
  }

  const updates = await prisma.taskProgressUpdate.findMany({
    where: allUpdates ? { taskId: task.id } : { taskId: task.id, userId: assigneeUserId },
    include: { user: { select: { id: true, displayName: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const delegations = isOwner
    ? await prisma.taskDelegation.findMany({
        where: { taskId: task.id },
        include: {
          fromUser: { select: { id: true, displayName: true } },
          toUser: { select: { id: true, displayName: true } },
        },
        orderBy: [{ createdAt: "asc" }],
      })
    : [];

  const assignee = assigneeUserId
    ? task.assignments.find((a) => a.userId === assigneeUserId)
    : null;
  res.json({
    taskTitle: task.title,
    assigneeUserId: assigneeUserId ?? null,
    assigneeName: assignee?.user?.displayName ?? "",
    updates: updates.map(serializeProgressUpdate),
    delegations: delegations.map(serializeDelegation),
  });
});

router.post("/:id/delegate", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }

  const parsed = delegateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { employeeId } = parsed.data;
  if (employeeId === req.session.userId) {
    return res.status(400).json({ error: "You cannot delegate a task to yourself" });
  }

  const target = await prisma.user.findFirst({
    where: { id: employeeId, role: "employee" },
    select: { id: true },
  });
  if (!target) {
    return res.status(400).json({ error: "Invalid employee" });
  }

  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { assignments: true, list: { select: { ownerId: true } } },
  });
  if (!task || !taskIsAssignedToUser(task, req.session.userId)) {
    return res.status(404).json({ error: "Task not found" });
  }

  const myRow = task.assignments.find((a) => a.userId === req.session.userId);
  if (!myRow) {
    return res.status(404).json({ error: "Task not found" });
  }
  if (myRow.assigneeDone) {
    return res.status(400).json({ error: "Cannot delegate a task that is already submitted" });
  }
  if (task.assignments.some((a) => a.userId === employeeId)) {
    return res.status(400).json({ error: "That employee is already assigned to this task" });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.taskAssignee.delete({
      where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
    }),
    prisma.taskAssignee.create({
      data: {
        taskId: task.id,
        userId: employeeId,
        assignedByUserId: req.session.userId,
        delegatedAt: now,
      },
    }),
    prisma.taskDelegation.create({
      data: {
        taskId: task.id,
        fromUserId: req.session.userId,
        toUserId: employeeId,
      },
    }),
  ]);

  await syncTaskCompletedFromAssignments(task.id);

  const fresh = await prisma.task.findFirst({
    where: { id: task.id },
    include: { ...taskAssigneeInclude, ...taskListSelect },
  });
  const withMeta = (await attachProgressUpdateMeta([fresh]))[0];
  const withDelegations = (await attachDelegationsToTasks([withMeta]))[0];
  res.json({ task: serializeTask(withDelegations) });
});

router.post("/:id/progress-updates", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }

  const parsed = progressUpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { assignments: { where: { userId: req.session.userId } } },
  });
  if (!task || !taskIsAssignedToUser(task, req.session.userId)) {
    return res.status(404).json({ error: "Task not found" });
  }

  const row = await prisma.taskProgressUpdate.create({
    data: {
      taskId: task.id,
      userId: req.session.userId,
      updateType: parsed.data.updateType,
      message: parsed.data.message,
    },
    include: { user: { select: { id: true, displayName: true } } },
  });

  res.status(201).json({ update: serializeProgressUpdate(row) });
});

const progressUpdateMarkReadSchema = z.object({
  assigneeUserId: z.string().uuid(),
});

router.post("/:id/progress-updates/mark-read", requireOwner, async (req, res) => {
  const parsed = progressUpdateMarkReadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, assignments: { select: { userId: true } } },
  });
  if (!task || task.list.ownerId !== req.session.userId) {
    return res.status(404).json({ error: "Task not found" });
  }

  const { assigneeUserId } = parsed.data;
  if (!task.assignments.some((a) => a.userId === assigneeUserId)) {
    return res.status(404).json({ error: "Assignee not found on this task" });
  }

  const now = new Date();
  await prisma.taskProgressUpdateRead.upsert({
    where: {
      taskId_assigneeUserId_ownerId: {
        taskId: task.id,
        assigneeUserId,
        ownerId: req.session.userId,
      },
    },
    create: {
      taskId: task.id,
      assigneeUserId,
      ownerId: req.session.userId,
      lastReadAt: now,
    },
    update: { lastReadAt: now },
  });

  res.json({ ok: true, lastReadAt: now.toISOString() });
});

router.get("/:id/submission", requireAuth, async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, assignments: { include: { user: { select: { id: true } } } } },
  });
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const assigneeUserId =
    req.session.role === "employee"
      ? req.session.userId
      : typeof req.query.assigneeUserId === "string"
        ? req.query.assigneeUserId
        : null;
  if (!assigneeUserId) {
    return res.status(400).json({ error: "assigneeUserId query parameter is required" });
  }

  const row = task.assignments.find((a) => a.userId === assigneeUserId);
  if (!row) {
    return res.status(404).json({ error: "Assignee not found on this task" });
  }

  const isOwner = task.list.ownerId === req.session.userId;
  const isSelfEmployee =
    req.session.role === "employee" &&
    req.session.userId === assigneeUserId &&
    taskIsAssignedToUser(task, req.session.userId);
  if (!isOwner && !isSelfEmployee) {
    return res.status(403).json({ error: "Not allowed" });
  }

  const submissionText = (row.submissionText ?? "").trim() || null;
  res.json({
    taskTitle: task.title,
    assigneeUserId,
    submissionText,
    completionProofUrl: row.completionProofPath
      ? `/api/tasks/${task.id}/completion-proof/${assigneeUserId}`
      : null,
  });
});

router.get("/:id/completion-proof/:assigneeUserId", requireAuth, async (req, res) => {
  const assigneeUserId = req.params.assigneeUserId;
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, assignments: { include: { user: { select: { id: true } } } } },
  });
  if (!task) {
    return res.status(404).send("Not found");
  }
  const row = task.assignments.find((a) => a.userId === assigneeUserId);
  if (!row?.completionProofPath) {
    return res.status(404).send("Not found");
  }
  const isOwner = task.list.ownerId === req.session.userId;
  const isSelfEmployee =
    req.session.role === "employee" &&
    req.session.userId === assigneeUserId &&
    taskIsAssignedToUser(task, req.session.userId);
  if (!isOwner && !isSelfEmployee) {
    return res.status(403).send("Forbidden");
  }
  const full = proofAbsolutePath(row.completionProofPath);
  if (!full) {
    return res.status(404).send("Not found");
  }
  res.type(proofContentType(row.completionProofPath));
  res.sendFile(full);
});

router.post("/:id/completion-proof", requireAuth, handleProofUpload, async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id },
      include: { list: true, ...taskAssigneeInclude },
    });
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    const isAssignee = req.session.role === "employee" && taskIsAssignedToUser(task, req.session.userId);
    if (!isAssignee) {
      return res.status(403).json({ error: "Only an assigned employee can submit work" });
    }

    const my = task.assignments.find((a) => a.userId === req.session.userId);
    const submissionText = readSubmissionTextFromBody(req).trim();
    const proofFile = getProofUploadFile(req);
    if (submissionText.length > SUBMISSION_TEXT_MAX) {
      return res.status(400).json({ error: `Submission notes must be ${SUBMISSION_TEXT_MAX} characters or fewer.` });
    }

    let completionProofPath = my?.completionProofPath ?? null;
    if (proofFile) {
      if (my?.completionProofPath) {
        deleteProofFile(my.completionProofPath);
      }
      completionProofPath = proofFile.filename;
    }

    if (!submissionText && !completionProofPath) {
      return res.status(400).json({ error: SUBMISSION_REQUIRED_MSG });
    }

    await prisma.taskAssignee.update({
      where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
      data: {
        completionProofPath,
        submissionText: submissionText || null,
        assigneeDone: true,
      },
    });
    await syncTaskCompletedFromAssignments(task.id);
    const fresh = await prisma.task.findFirst({
      where: { id: task.id },
      include: { ...taskAssigneeInclude, ...taskListSelect },
    });
    if (fresh) {
      await maybeRollRecurringAfterEmployeeComplete(fresh, req.session.userId);
    }
    const updated = await prisma.task.findUnique({
      where: { id: task.id },
      include: { ...taskAssigneeInclude, ...taskListSelect },
    });
    res.json({ task: serializeTask(updated) });
  } catch (err) {
    console.error("[completion-proof]", err);
    const hint = submissionServerErrorMessage(err);
    if (hint) {
      return res.status(500).json({ error: hint });
    }
    throw err;
  }
});

const reorderSchema = z.object({
  listId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
});

router.patch("/reorder/bulk", requireOwner, async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { listId, orderedIds } = parsed.data;
  const list = await assertListOwner(listId, req.session.userId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const tasks = await prisma.task.findMany({
    where: { listId },
    select: { id: true },
  });
  const set = new Set(tasks.map((t) => t.id));
  if (orderedIds.length !== tasks.length || !orderedIds.every((id) => set.has(id))) {
    return res.status(400).json({ error: "Invalid task order" });
  }
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.task.update({ where: { id }, data: { sortOrder: i } }))
  );
  res.json({ ok: true });
});

router.post("/lists/:listId/clear-completed", requireOwner, async (req, res) => {
  const list = await assertListOwner(req.params.listId, req.session.userId);
  if (!list) return res.status(404).json({ error: "List not found" });
  const toRemove = await prisma.task.findMany({
    where: { listId: list.id, completed: true },
    include: { assignments: { select: { completionProofPath: true } } },
  });
  for (const t of toRemove) {
    for (const a of t.assignments) {
      if (a.completionProofPath) deleteProofFile(a.completionProofPath);
    }
  }
  await prisma.task.deleteMany({
    where: { listId: list.id, completed: true },
  });
  res.json({ ok: true });
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(20000).optional(),
  starred: z.boolean().optional(),
  dueAt: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  dueTimeZone: z.string().min(1).max(64).optional().nullable(),
  allDay: z.boolean().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  recurrenceRule: z.any().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
});

router.post("/lists/:listId", requireOwner, async (req, res) => {
  const list = await assertListOwner(req.params.listId, req.session.userId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const assigneeIds = await resolveEmployeeIds(parsed.data.assigneeIds ?? []);

  const maxOrder = await prisma.task.aggregate({
    where: { listId: list.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  let dueAt = null;
  let dueTimeZone = null;
  if (parsed.data.dueAt && String(parsed.data.dueAt).length > 0) {
    dueAt = new Date(parsed.data.dueAt);
    dueTimeZone = parsed.data.dueTimeZone?.trim() || null;
  }

  const recurrence = parsed.data.recurrence ?? "none";
  let recurrenceRuleStr = null;
  if (recurrence === "custom" && parsed.data.recurrenceRule != null) {
    const rule = parseRecurrenceRule(parsed.data.recurrenceRule);
    if (!rule) {
      return res.status(400).json({ error: "Invalid custom recurrence rule" });
    }
    recurrenceRuleStr = JSON.stringify({ ...rule, occurrencesCompleted: 0 });
  }

  const createPayload = {
    listId: list.id,
    createdById: req.session.userId,
    title: parsed.data.title.trim(),
    notes: parsed.data.notes?.trim() ?? "",
    starred: parsed.data.starred ?? false,
    dueAt,
    dueTimeZone,
    allDay: parsed.data.allDay ?? false,
    recurrence,
    sortOrder,
    assignments:
      assigneeIds.length > 0
        ? {
            create: assigneeIds.map((userId) => ({ userId })),
          }
        : undefined,
  };
  if (recurrenceRuleStr != null) {
    createPayload.recurrenceRule = recurrenceRuleStr;
  }

  const task = await prisma.task.create({
    data: createPayload,
    include: taskAssigneeInclude,
  });
  res.status(201).json({ task: serializeTask(task) });
});

const patchTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(20000).optional(),
  completed: z.boolean().optional(),
  starred: z.boolean().optional(),
  dueAt: z.union([z.string().min(1), z.null()]).optional(),
  dueTimeZone: z.string().min(1).max(64).optional().nullable(),
  allDay: z.boolean().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  recurrenceRule: z.any().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  assigneeSetDone: z
    .object({
      userId: z.string().uuid(),
      assigneeDone: z.boolean(),
    })
    .optional(),
});

router.patch("/:id", requireAuth, async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, ...taskAssigneeInclude },
  });
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const isOwner = task.list.ownerId === req.session.userId;
  const isAssignee =
    req.session.role === "employee" && taskIsAssignedToUser(task, req.session.userId);

  if (!isOwner && !isAssignee) {
    return res.status(403).json({ error: "Not allowed" });
  }

  const parsed = patchTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let clearRecurrenceRule = false;
  const data = {};

  if (isOwner) {
    if (parsed.data.assigneeSetDone) {
      const { userId, assigneeDone } = parsed.data.assigneeSetDone;
      const row = task.assignments.find((a) => a.userId === userId);
      if (!row) {
        return res.status(400).json({ error: "That employee is not assigned to this task" });
      }
      if (!assigneeDone && row.completionProofPath) {
        deleteProofFile(row.completionProofPath);
      }
      await prisma.taskAssignee.update({
        where: { taskId_userId: { taskId: task.id, userId } },
        data: assigneeDone ? { assigneeDone: true } : clearAssigneeSubmissionUpdate(false),
      });
      await syncTaskCompletedFromAssignments(task.id);
      const afterAssignee = await prisma.task.findUnique({
        where: { id: task.id },
        include: taskAssigneeInclude,
      });
      return res.json({ task: serializeTask(afterAssignee) });
    }

    if (parsed.data.title != null) data.title = parsed.data.title.trim();
    if (parsed.data.notes != null) data.notes = parsed.data.notes;
    if (parsed.data.starred != null) data.starred = parsed.data.starred;
    if (parsed.data.dueAt !== undefined) {
      data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
      data.dueTimeZone = parsed.data.dueAt
        ? parsed.data.dueTimeZone?.trim() || null
        : null;
    } else if (parsed.data.dueTimeZone !== undefined) {
      data.dueTimeZone = parsed.data.dueTimeZone?.trim() || null;
    }
    if (parsed.data.allDay !== undefined) data.allDay = parsed.data.allDay;

    if (parsed.data.completed !== undefined && task.assignments.length > 0) {
      const v = parsed.data.completed;
      if (!v) {
        for (const a of task.assignments) {
          if (a.completionProofPath) deleteProofFile(a.completionProofPath);
        }
        await prisma.taskAssignee.updateMany({
          where: { taskId: task.id },
          data: clearAssigneeSubmissionUpdate(false),
        });
      } else {
        await prisma.taskAssignee.updateMany({
          where: { taskId: task.id },
          data: { assigneeDone: true },
        });
      }
      data.completed = v;
    } else if (parsed.data.completed !== undefined) {
      data.completed = parsed.data.completed;
    }

    if (parsed.data.recurrence !== undefined) {
      data.recurrence = parsed.data.recurrence;
      if (parsed.data.recurrence !== "custom") {
        clearRecurrenceRule = true;
      }
    }
    if (parsed.data.recurrenceRule !== undefined) {
      if (parsed.data.recurrenceRule === null) {
        clearRecurrenceRule = true;
      } else {
        const rule = parseRecurrenceRule(parsed.data.recurrenceRule);
        if (!rule) {
          return res.status(400).json({ error: "Invalid custom recurrence rule" });
        }
        data.recurrenceRule = JSON.stringify({ ...rule, occurrencesCompleted: 0 });
        data.recurrence = "custom";
        clearRecurrenceRule = false;
      }
    }
    if (parsed.data.assigneeIds !== undefined) {
      for (const a of task.assignments) {
        if (a.completionProofPath) deleteProofFile(a.completionProofPath);
      }
      const resolved = await resolveEmployeeIds(parsed.data.assigneeIds);
      data.assignments = {
        deleteMany: {},
        ...(resolved.length > 0 ? { create: resolved.map((userId) => ({ userId })) } : {}),
      };
    }
  } else if (isAssignee) {
    const d = parsed.data;
    const disallowed =
      d.title !== undefined ||
      d.notes !== undefined ||
      d.starred !== undefined ||
      d.dueAt !== undefined ||
      d.allDay !== undefined ||
      d.recurrence !== undefined ||
      d.recurrenceRule !== undefined ||
      d.assigneeIds !== undefined;
    if (disallowed || d.completed === undefined) {
      return res.status(403).json({ error: "Employees may only set completed" });
    }
    const myRow = task.assignments.find((a) => a.userId === req.session.userId);
    if (d.completed === true && !assigneeHasSubmissionContent(myRow)) {
      return res.status(400).json({ error: SUBMISSION_REQUIRED_MSG });
    }
    const prevPath = myRow?.completionProofPath;
    if (d.completed === false) {
      if (prevPath) deleteProofFile(prevPath);
      await prisma.taskAssignee.update({
        where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
        data: clearAssigneeSubmissionUpdate(false),
      });
    } else {
      await prisma.taskAssignee.update({
        where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
        data: { assigneeDone: true },
      });
    }
    await syncTaskCompletedFromAssignments(task.id);
    const fresh = await prisma.task.findFirst({
      where: { id: task.id },
      include: { ...taskAssigneeInclude, ...taskListSelect },
    });
    if (fresh && d.completed === true) {
      await maybeRollRecurringAfterEmployeeComplete(fresh, req.session.userId);
    }
    const afterAssignee = await prisma.task.findUnique({
      where: { id: task.id },
      include: { ...taskAssigneeInclude, ...taskListSelect },
    });
    return res.json({ task: serializeTask(afterAssignee) });
  }

  let updated;
  if (Object.keys(data).length > 0) {
    updated = await prisma.task.update({
      where: { id: task.id },
      data,
      include: taskAssigneeInclude,
    });
  } else {
    updated =
      (await prisma.task.findUnique({
        where: { id: task.id },
        include: taskAssigneeInclude,
      })) ?? task;
  }
  if (clearRecurrenceRule) {
    await prisma.$executeRaw`UPDATE \`Task\` SET recurrence_rule = NULL WHERE id = ${task.id}`;
    updated =
      (await prisma.task.findUnique({
        where: { id: task.id },
        include: taskAssigneeInclude,
      })) ?? updated;
  }

  if (isOwner && parsed.data.assigneeIds !== undefined) {
    await syncTaskCompletedFromAssignments(task.id);
    updated =
      (await prisma.task.findUnique({
        where: { id: task.id },
        include: taskAssigneeInclude,
      })) ?? updated;
  }

  res.json({ task: serializeTask(updated) });
});

router.delete("/:id", requireOwner, async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, assignments: { select: { completionProofPath: true } } },
  });
  if (!task || task.list.ownerId !== req.session.userId) {
    return res.status(404).json({ error: "Task not found" });
  }
  for (const a of task.assignments) {
    if (a.completionProofPath) deleteProofFile(a.completionProofPath);
  }
  await prisma.task.delete({ where: { id: task.id } });
  res.json({ ok: true });
});

const moveSchema = z.object({
  listId: z.string().uuid(),
});

router.post("/:id/move", requireOwner, async (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const targetList = await assertListOwner(parsed.data.listId, req.session.userId);
  if (!targetList) return res.status(404).json({ error: "Target list not found" });

  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true },
  });
  if (!task || task.list.ownerId !== req.session.userId) {
    return res.status(404).json({ error: "Task not found" });
  }

  const maxOrder = await prisma.task.aggregate({
    where: { listId: targetList.id },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  await prisma.task.update({
    where: { id: task.id },
    data: { listId: targetList.id, sortOrder },
  });

  const updated = await prisma.task.findUnique({
    where: { id: task.id },
    include: taskAssigneeInclude,
  });
  res.json({ task: serializeTask(updated) });
});

export default router;
