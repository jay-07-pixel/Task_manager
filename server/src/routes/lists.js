import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireOwner } from "../middleware/auth.js";

const router = Router();

const EMPLOYEE_ASSIGNMENTS_LIST_TITLE = "Employee assignments";

router.use(requireOwner);

async function ensureEmployeeAssignmentsList(ownerId) {
  let list = await prisma.taskList.findFirst({
    where: { ownerId, title: EMPLOYEE_ASSIGNMENTS_LIST_TITLE },
  });
  if (!list) {
    const maxOrder = await prisma.taskList.aggregate({
      where: { ownerId },
      _max: { sortOrder: true },
    });
    list = await prisma.taskList.create({
      data: {
        ownerId,
        title: EMPLOYEE_ASSIGNMENTS_LIST_TITLE,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });
  }
  return list;
}

function listKind(title) {
  return title === EMPLOYEE_ASSIGNMENTS_LIST_TITLE ? "employee_assignments" : "user";
}

router.get("/", async (req, res) => {
  await ensureEmployeeAssignmentsList(req.session.userId);
  const lists = await prisma.taskList.findMany({
    where: { ownerId: req.session.userId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, title: true, sortOrder: true },
  });
  res.json({
    lists: lists.map((l) => ({
      ...l,
      kind: listKind(l.title),
    })),
  });
});

const createListSchema = z.object({
  title: z.string().min(1).max(200),
});

router.post("/", async (req, res) => {
  const parsed = createListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const maxOrder = await prisma.taskList.aggregate({
    where: { ownerId: req.session.userId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;
  const list = await prisma.taskList.create({
    data: {
      ownerId: req.session.userId,
      title: parsed.data.title.trim(),
      sortOrder,
    },
  });
  res.status(201).json({
    list: { id: list.id, title: list.title, sortOrder: list.sortOrder, kind: listKind(list.title) },
  });
});

const patchListSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

router.patch("/:id", async (req, res) => {
  const list = await prisma.taskList.findFirst({
    where: { id: req.params.id, ownerId: req.session.userId },
  });
  if (!list) return res.status(404).json({ error: "List not found" });
  const parsed = patchListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = {};
  if (parsed.data.title != null) data.title = parsed.data.title.trim();
  const updated = await prisma.taskList.update({
    where: { id: list.id },
    data,
  });
  res.json({
    list: {
      id: updated.id,
      title: updated.title,
      sortOrder: updated.sortOrder,
      kind: listKind(updated.title),
    },
  });
});

router.delete("/:id", async (req, res) => {
  const list = await prisma.taskList.findFirst({
    where: { id: req.params.id, ownerId: req.session.userId },
  });
  if (!list) return res.status(404).json({ error: "List not found" });
  if (list.title === EMPLOYEE_ASSIGNMENTS_LIST_TITLE) {
    return res.status(400).json({ error: "The Employee assignments list cannot be deleted" });
  }
  await prisma.taskList.delete({ where: { id: list.id } });
  res.json({ ok: true });
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
});

router.patch("/reorder/bulk", async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { orderedIds } = parsed.data;
  const owned = await prisma.taskList.findMany({
    where: { ownerId: req.session.userId },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((l) => l.id));
  if (orderedIds.length !== owned.length || !orderedIds.every((id) => ownedSet.has(id))) {
    return res.status(400).json({ error: "Invalid list order" });
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.taskList.update({ where: { id }, data: { sortOrder: i } })
    )
  );
  res.json({ ok: true });
});

export default router;
