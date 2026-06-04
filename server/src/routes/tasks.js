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

const taskAssigneeInclude = {
  assignments: {
    include: {
      user: { select: { id: true, displayName: true, email: true } },
    },
  },
};

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
    data: { assigneeDone: false, completionProofPath: null },
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
    completionProofUrl: a.completionProofPath
      ? `/api/tasks/${t.id}/completion-proof/${a.userId}`
      : null,
  }));
  return {
    id: t.id,
    listId: t.listId,
    list: t.list ? { id: t.list.id, title: t.list.title } : null,
    assignees,
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

router.get("/assigned", requireAuth, async (req, res) => {
  if (req.session.role !== "employee") {
    return res.status(403).json({ error: "Employees only" });
  }
  const tasks = await prisma.task.findMany({
    where: { assignments: { some: { userId: req.session.userId } } },
    include: { ...taskAssigneeInclude, list: { select: { id: true, title: true } } },
    orderBy: [{ sortOrder: "asc" }],
  });
  res.json({ tasks: tasks.map(serializeTask) });
});

router.get("/lists/:listId", requireOwner, async (req, res) => {
  const list = await assertListOwner(req.params.listId, req.session.userId);
  if (!list) return res.status(404).json({ error: "List not found" });

  const roots = await prisma.task.findMany({
    where: { listId: list.id },
    include: taskAssigneeInclude,
    orderBy: [{ completed: "asc" }, { sortOrder: "asc" }],
  });
  res.json({ tasks: roots.map(serializeTask) });
});

/** Must be before /:id PATCH so "completion-proof" is not captured as id */
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
  res.sendFile(full);
});

router.post("/:id/completion-proof", requireAuth, proofUpload.single("proof"), async (req, res) => {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id },
    include: { list: true, ...taskAssigneeInclude },
  });
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const isAssignee = req.session.role === "employee" && taskIsAssignedToUser(task, req.session.userId);
  if (!isAssignee) {
    return res.status(403).json({ error: "Only an assigned employee can upload proof" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Image file (proof) is required" });
  }
  const my = task.assignments.find((a) => a.userId === req.session.userId);
  if (my?.completionProofPath) {
    deleteProofFile(my.completionProofPath);
  }
  await prisma.taskAssignee.update({
    where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
    data: {
      completionProofPath: req.file.filename,
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
        data: {
          assigneeDone,
          ...(assigneeDone === false ? { completionProofPath: null } : {}),
        },
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
          data: { assigneeDone: false, completionProofPath: null },
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
    const prevPath = myRow?.completionProofPath;
    await prisma.taskAssignee.update({
      where: { taskId_userId: { taskId: task.id, userId: req.session.userId } },
      data: {
        assigneeDone: d.completed,
        ...(d.completed === false ? { completionProofPath: null } : {}),
      },
    });
    if (d.completed === false && prevPath) {
      deleteProofFile(prevPath);
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
