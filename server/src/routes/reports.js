import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireOwner } from "../middleware/auth.js";
import { adminUserWhere } from "../lib/adminUsers.js";
import { buildOrgMonthlyMinuteBudgetReport } from "../services/employeeMonthlyMinutesService.js";

const router = Router();

router.use(requireOwner);

const EMPLOYEE_ASSIGNMENTS_LIST_TITLE = "Employee assignments";
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

function dayKey(d) {
  const dt = new Date(d);
  dt.setHours(12, 0, 0, 0);
  return dt.toISOString().slice(0, 10);
}

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

const PERIOD_BUCKETS = { daily: 14, weekly: 12, monthly: 6 };

function lastPeriodBuckets(period) {
  const n = PERIOD_BUCKETS[period] ?? PERIOD_BUCKETS.daily;
  const labels = [];
  const keys = [];
  const now = new Date();

  if (period === "daily") {
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      keys.push(key);
      labels.push(
        new Date(`${key}T12:00:00`).toLocaleDateString("en-IN", { month: "short", day: "numeric" })
      );
    }
    return { labels, keys };
  }

  if (period === "weekly") {
    return lastNWeekLabels(n);
  }

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    keys.push(key);
    labels.push(d.toLocaleDateString("en-IN", { month: "short", year: "numeric" }));
  }
  return { labels, keys };
}

function assignmentDate(row) {
  return row.delegatedAt ?? row.task.createdAt;
}

function classifyAssigneeRow(row) {
  if (!row.assigneeDone) return "pending";
  if (!row.lastSubmittedAt) return "onTime";
  if (!row.task.dueAt) return "onTime";
  return row.lastSubmittedAt <= row.task.dueAt ? "onTime" : "late";
}

function submissionLateDayCount(submittedAt, dueAt) {
  const submitted = new Date(submittedAt);
  const due = new Date(dueAt);
  if (Number.isNaN(submitted.getTime()) || Number.isNaN(due.getTime())) return 0;
  if (submitted.getTime() <= due.getTime()) return 0;
  return Math.max(1, Math.ceil((submitted.getTime() - due.getTime()) / 86_400_000));
}

function bucketForDate(date, period) {
  if (period === "daily") return dayKey(date);
  if (period === "weekly") return weekKey(date);
  return monthKey(date);
}

async function orgOwnerIds() {
  const owners = await prisma.user.findMany({
    where: adminUserWhere,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return owners.map((o) => o.id);
}

function adminAllocator(row) {
  if (row.assignedBy) {
    return { id: row.assignedBy.id, name: row.assignedBy.displayName || "Admin" };
  }
  if (row.task?.createdBy) {
    return { id: row.task.createdBy.id, name: row.task.createdBy.displayName || "Admin" };
  }
  return { id: "unknown", name: "Unknown" };
}

function rowInPeriod(row, period, keySet) {
  const assignedAt = assignmentDate(row);
  const key = bucketForDate(assignedAt, period);
  return keySet.has(key);
}

router.get("/owner-dashboard/summary", async (req, res) => {
  try {
    const ownerIds = await orgOwnerIds();
    if (!ownerIds.length) {
      return res.json({ generatedAt: new Date().toISOString(), employeeOptions: [] });
    }

    const tasks = await prisma.task.findMany({
      where: { list: { ownerId: { in: ownerIds } } },
      select: {
        assignments: {
          select: {
            userId: true,
            user: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    const byEmployee = new Map();
    for (const task of tasks) {
      for (const a of task.assignments) {
        const name = a.user.displayName || "Employee";
        if (!byEmployee.has(a.userId)) {
          byEmployee.set(a.userId, { id: a.userId, name });
        }
      }
    }

    const employeeOptions = [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name));
    const monthlyMinuteBudget = await buildOrgMonthlyMinuteBudgetReport(ownerIds);

    res.json({
      generatedAt: new Date().toISOString(),
      employeeOptions,
      monthlyMinuteBudget,
    });
  } catch (err) {
    console.error("owner-dashboard summary error:", err);
    res.status(500).json({ error: "Could not load owner dashboard" });
  }
});

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

  for (const task of tasks) {
    const listTitle =
      task.list.title === EMPLOYEE_ASSIGNMENTS_LIST_TITLE ? "Employee assignments" : task.list.title;
    byList.set(listTitle, (byList.get(listTitle) || 0) + 1);

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

  const listChart = [...byList.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const employeeChart = [...byEmployee.entries()]
    .sort((a, b) => b[1].assigned - a[1].assigned)
    .slice(0, 12)
    .map(([id, row]) => ({ id, ...row }));

  const employeeOptions = [...byEmployee.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, row]) => ({ id, name: row.name }));

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
    employeeOptions,
  });
});

router.get("/employee-performance", async (req, res) => {
  try {
    const ownerId = req.session.userId;
    const scope = req.query.scope === "org" ? "org" : "session";
    const ownerIds =
      scope === "org" ? await orgOwnerIds() : [ownerId];
    const listOwnerWhere = ownerIds.length ? { in: ownerIds } : ownerId;

  const employeeId = String(req.query.employeeId || "").trim();
  const period = ["daily", "weekly", "monthly"].includes(req.query.period) ? req.query.period : "daily";

  if (!employeeId) {
    return res.status(400).json({ error: "employeeId is required" });
  }

  const employee = await prisma.user.findFirst({
    where: {
      id: employeeId,
      role: "employee",
      taskAssignments: { some: { task: { list: { ownerId: listOwnerWhere } } } },
    },
    select: { id: true, displayName: true },
  });

  if (!employee) {
    return res.status(404).json({ error: "Employee not found or has no tasks under your account" });
  }

  const rows = await prisma.taskAssignee.findMany({
    where: {
      userId: employeeId,
      task: { list: { ownerId: listOwnerWhere } },
    },
    select: {
      assignedByUserId: true,
      assigneeDone: true,
      lastSubmittedAt: true,
      delegatedAt: true,
      assignedBy: { select: { id: true, displayName: true } },
      task: {
        select: {
          id: true,
          title: true,
          createdAt: true,
          dueAt: true,
          createdById: true,
          createdBy: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const { labels, keys } = lastPeriodBuckets(period);
  const keySet = new Set(keys);
  const buckets = Object.fromEntries(
    keys.map((k) => [k, { allocated: 0, onTime: 0, late: 0, pending: 0 }])
  );

  const byAdminMap = new Map();

  for (const row of rows) {
    const assignedAt = assignmentDate(row);
    const key = bucketForDate(assignedAt, period);
    const status = classifyAssigneeRow(row);
    const admin = adminAllocator(row);

    if (keySet.has(key)) {
      const bucket = buckets[key];
      bucket.allocated += 1;
      bucket[status] += 1;
    }

    if (!rowInPeriod(row, period, keySet)) continue;

    const adminRow = byAdminMap.get(admin.id) || {
      id: admin.id,
      name: admin.name,
      allocated: 0,
      onTime: 0,
      late: 0,
      pending: 0,
    };
    adminRow.allocated += 1;
    adminRow[status] += 1;
    byAdminMap.set(admin.id, adminRow);
  }

  const series = keys.map((k) => buckets[k]);
  const totals = series.reduce(
    (acc, b) => ({
      allocated: acc.allocated + b.allocated,
      onTime: acc.onTime + b.onTime,
      late: acc.late + b.late,
      pending: acc.pending + b.pending,
    }),
    { allocated: 0, onTime: 0, late: 0, pending: 0 }
  );

  const byAdmin = [...byAdminMap.values()].sort((a, b) => b.allocated - a.allocated || a.name.localeCompare(b.name));

  const lateSubmissions = rows
    .filter((row) => {
      if (classifyAssigneeRow(row) !== "late") return false;
      return rowInPeriod(row, period, keySet);
    })
    .map((row) => ({
      taskId: row.task.id,
      title: row.task.title,
      dueAt: row.task.dueAt,
      submittedAt: row.lastSubmittedAt,
      lateDays: submissionLateDayCount(row.lastSubmittedAt, row.task.dueAt),
      assignedAt: assignmentDate(row),
      assignedBy: adminAllocator(row),
    }))
    .sort((a, b) => b.lateDays - a.lateDays || new Date(b.submittedAt) - new Date(a.submittedAt));

  res.json({
    employee: { id: employee.id, name: employee.displayName || "Employee" },
    period,
    scope,
    bucketCount: keys.length,
    labels,
    totals,
    byAdmin,
    lateSubmissions,
    series: {
      allocated: series.map((b) => b.allocated),
      onTime: series.map((b) => b.onTime),
      late: series.map((b) => b.late),
      pending: series.map((b) => b.pending),
    },
  });
  } catch (err) {
    console.error("employee-performance report error:", err);
    res.status(500).json({ error: "Could not load employee performance report" });
  }
});

export default router;
