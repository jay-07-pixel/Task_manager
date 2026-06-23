import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireOwner } from "../middleware/auth.js";

const router = Router();

router.use(requireOwner);

const EMPLOYEE_ASSIGNMENTS_LIST_TITLE = "Employee assignments";
const WEEKS_TREND = 12;
const CHAT_DAYS = 30;

function weekKey(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(dt);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

function lastNWeekLabels(n) {
  const labels = [];
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const key = weekKey(d);
    keys.push(key);
    const label = new Date(`${key}T12:00:00`).toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    });
    labels.push(label);
  }
  return { labels, keys };
}

router.get("/summary", async (req, res) => {
  const ownerId = req.session.userId;
  const now = new Date();
  const chatSince = new Date(now);
  chatSince.setDate(chatSince.getDate() - CHAT_DAYS);

  const [lists, tasks, employees, progressUpdateTotal, chatDm, chatGroup] = await Promise.all([
    prisma.taskList.findMany({
      where: { ownerId },
      select: { id: true, title: true },
    }),
    prisma.task.findMany({
      where: { list: { ownerId } },
      select: {
        id: true,
        listId: true,
        title: true,
        completed: true,
        dueAt: true,
        createdAt: true,
        list: { select: { title: true } },
        assignments: {
          select: {
            assigneeDone: true,
            userId: true,
            user: { select: { id: true, displayName: true } },
          },
        },
        progressUpdates: { select: { userId: true } },
      },
    }),
    prisma.user.count({ where: { role: "employee" } }),
    prisma.taskProgressUpdate.count({
      where: { task: { list: { ownerId } } },
    }),
    prisma.chatMessage.count({
      where: {
        deletedAt: null,
        createdAt: { gte: chatSince },
        conversation: { OR: [{ userLowId: ownerId }, { userHighId: ownerId }] },
      },
    }),
    prisma.chatGroupMessage.count({
      where: {
        deletedAt: null,
        createdAt: { gte: chatSince },
        group: { members: { some: { userId: ownerId } } },
      },
    }),
  ]);

  let active = 0;
  let completed = 0;
  let inReview = 0;
  let overdue = 0;
  let withAssignees = 0;
  let submissions = 0;

  const byList = new Map();
  const byEmployee = new Map();
  const { labels: weekLabels, keys: weekKeys } = lastNWeekLabels(WEEKS_TREND);
  const createdByWeek = Object.fromEntries(weekKeys.map((k) => [k, 0]));
  const submittedByWeek = Object.fromEntries(weekKeys.map((k) => [k, 0]));

  for (const task of tasks) {
    const listTitle =
      task.list.title === EMPLOYEE_ASSIGNMENTS_LIST_TITLE ? "Employee assignments" : task.list.title;
    byList.set(listTitle, (byList.get(listTitle) || 0) + 1);

    const wk = weekKey(task.createdAt);
    if (createdByWeek[wk] !== undefined) createdByWeek[wk] += 1;

    if (task.completed) {
      completed += 1;
    } else {
      const taskInReview = task.assignments.some(
        (a) => task.progressUpdates.some((u) => u.userId === a.userId) && !a.assigneeDone
      );
      if (taskInReview) inReview += 1;
      else active += 1;
    }

    if (task.dueAt && !task.completed && task.dueAt < now) overdue += 1;

    if (task.assignments.length > 0) withAssignees += 1;

    for (const a of task.assignments) {
      const name = a.user.displayName || "Employee";
      const row = byEmployee.get(a.userId) || {
        name,
        assigned: 0,
        submitted: 0,
        pending: 0,
      };
      row.assigned += 1;
      if (a.assigneeDone) {
        row.submitted += 1;
        submissions += 1;
      } else {
        row.pending += 1;
      }
      byEmployee.set(a.userId, row);
    }
  }

  const assigneeLastSubmit = await prisma.taskAssignee.findMany({
    where: { task: { list: { ownerId } }, assigneeDone: true, lastSubmittedAt: { not: null } },
    select: { lastSubmittedAt: true },
  });
  for (const row of assigneeLastSubmit) {
    if (!row.lastSubmittedAt) continue;
    const wk = weekKey(row.lastSubmittedAt);
    if (submittedByWeek[wk] !== undefined) submittedByWeek[wk] += 1;
  }

  const listChart = [...byList.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const employeeChart = [...byEmployee.values()]
    .sort((a, b) => b.assigned - a.assigned)
    .slice(0, 12);

  res.json({
    generatedAt: now.toISOString(),
    overview: {
      totalTasks: tasks.length,
      active,
      inReview,
      completed,
      overdue,
      withAssignees,
      totalSubmissions: submissions,
      employeeCount: employees,
      listCount: lists.filter((l) => l.title !== EMPLOYEE_ASSIGNMENTS_LIST_TITLE).length,
      progressUpdates: progressUpdateTotal,
      chatMessages30d: chatDm + chatGroup,
    },
    statusBreakdown: [
      { label: "Active", value: active, color: "#006d77" },
      { label: "In review", value: inReview, color: "#e65100" },
      { label: "Completed", value: completed, color: "#2e7d32" },
    ],
    tasksByList: listChart,
    employeePerformance: employeeChart,
    tasksCreatedWeekly: {
      labels: weekLabels,
      values: weekKeys.map((k) => createdByWeek[k] || 0),
    },
    submissionsWeekly: {
      labels: weekLabels,
      values: weekKeys.map((k) => submittedByWeek[k] || 0),
    },
  });
});

export default router;
