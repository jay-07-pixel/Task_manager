import { prisma } from "../lib/prisma.js";
import {
  MONTHLY_BUDGET_MINUTES,
  currentYearMonthInAppTz,
  draftTaskMonthlyMinutesCost,
  monthlyOccurrenceCount,
  taskMonthlyMinutesCost,
} from "../lib/employeeMonthlyMinutes.js";

/**
 * @param {string[]} userIds
 * @param {{ excludeTaskId?: string | null }} [opts]
 * @returns {Promise<Map<string, number>>}
 */
export async function computeEmployeeMonthlyUsedMinutes(userIds, opts = {}) {
  const ids = [...new Set(userIds)].filter(Boolean);
  const used = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return used;

  const { year, month } = currentYearMonthInAppTz();
  const excludeTaskId = opts.excludeTaskId?.trim() || null;

  const tasks = await prisma.task.findMany({
    where: {
      completed: false,
      ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
      assignments: { some: { userId: { in: ids } } },
    },
    select: {
      durationMinutes: true,
      recurrence: true,
      recurrenceRule: true,
      dueAt: true,
      completed: true,
      assignments: { select: { userId: true } },
    },
  });

  for (const task of tasks) {
    const cost = taskMonthlyMinutesCost(task, year, month);
    if (!cost) continue;
    for (const a of task.assignments) {
      if (!ids.includes(a.userId)) continue;
      used.set(a.userId, (used.get(a.userId) ?? 0) + cost);
    }
  }

  return used;
}

/**
 * @param {string[]} userIds
 * @param {{ excludeTaskId?: string | null, preview?: { durationMinutes?: number | null, recurrence?: string, recurrenceRule?: unknown, dueAt?: string | null } | null }} [opts]
 */
export async function buildEmployeeMonthlyBudgetRows(userIds, opts = {}) {
  const usedMap = await computeEmployeeMonthlyUsedMinutes(userIds, {
    excludeTaskId: opts.excludeTaskId,
  });

  const previewCost =
    opts.preview && (opts.preview.durationMinutes ?? 0) > 0
      ? draftTaskMonthlyMinutesCost({
          durationMinutes: opts.preview.durationMinutes,
          recurrence: opts.preview.recurrence ?? "none",
          recurrenceRule: opts.preview.recurrenceRule ?? null,
          dueAt: opts.preview.dueAt ?? null,
        })
      : 0;

  const { year, month } = currentYearMonthInAppTz();

  return userIds.map((userId) => {
    const usedMinutes = usedMap.get(userId) ?? 0;
    const remainingMinutes = Math.max(0, MONTHLY_BUDGET_MINUTES - usedMinutes);
    return {
      userId,
      monthlyBudgetMinutes: MONTHLY_BUDGET_MINUTES,
      usedMinutes,
      remainingMinutes,
      previewAssignmentMinutes: previewCost,
      remainingAfterPreview: Math.max(0, remainingMinutes - previewCost),
      budgetYear: year,
      budgetMonth: month,
    };
  });
}

/**
 * Owner-dashboard report: per-employee monthly minute usage from org task lists.
 * @param {string[]} ownerIds
 * @param {{ year?: number, month?: number }} [opts]
 */
export async function buildOrgMonthlyMinuteBudgetReport(ownerIds, opts = {}) {
  const ids = [...new Set(ownerIds)].filter(Boolean);
  const cur = currentYearMonthInAppTz();
  const year = Number.isInteger(opts.year) && opts.year > 2000 ? opts.year : cur.year;
  const month =
    Number.isInteger(opts.month) && opts.month >= 1 && opts.month <= 12
      ? opts.month
      : cur.month;

  if (!ids.length) {
    return {
      budgetYear: year,
      budgetMonth: month,
      monthlyBudgetMinutes: MONTHLY_BUDGET_MINUTES,
      employees: [],
      totals: {
        employeeCount: 0,
        totalBudgetMinutes: 0,
        totalUsedMinutes: 0,
        totalRemainingMinutes: 0,
        overBudgetEmployeeCount: 0,
      },
    };
  }

  const [tasks, assignments] = await Promise.all([
    prisma.task.findMany({
      where: {
        completed: false,
        list: { ownerId: { in: ids } },
        durationMinutes: { gt: 0 },
        assignments: { some: {} },
      },
      select: {
        id: true,
        title: true,
        durationMinutes: true,
        recurrence: true,
        recurrenceRule: true,
        dueAt: true,
        completed: true,
        list: { select: { title: true } },
        assignments: {
          select: {
            userId: true,
            user: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { title: "asc" },
    }),
    prisma.taskAssignee.findMany({
      where: { task: { list: { ownerId: { in: ids } } } },
      select: {
        userId: true,
        user: { select: { id: true, displayName: true } },
      },
      distinct: ["userId"],
    }),
  ]);

  const byEmployee = new Map();

  for (const a of assignments) {
    byEmployee.set(a.userId, {
      id: a.userId,
      name: a.user.displayName || "Employee",
      usedMinutes: 0,
      tasks: [],
    });
  }

  for (const task of tasks) {
    const monthlyCost = taskMonthlyMinutesCost(task, year, month);
    if (!monthlyCost) continue;
    const occurrences = monthlyOccurrenceCount(task, year, month);

    for (const a of task.assignments) {
      if (!byEmployee.has(a.userId)) {
        byEmployee.set(a.userId, {
          id: a.userId,
          name: a.user.displayName || "Employee",
          usedMinutes: 0,
          tasks: [],
        });
      }
      const row = byEmployee.get(a.userId);
      row.usedMinutes += monthlyCost;
      row.tasks.push({
        taskId: task.id,
        title: task.title,
        listTitle: task.list?.title ?? "",
        durationMinutes: task.durationMinutes,
        recurrence: task.recurrence ?? "none",
        occurrencesPerMonth: occurrences,
        monthlyMinutes: monthlyCost,
      });
    }
  }

  const employees = [...byEmployee.values()]
    .map((e) => {
      const usedMinutes = e.usedMinutes;
      const remainingMinutes = Math.max(0, MONTHLY_BUDGET_MINUTES - usedMinutes);
      const utilizationPct = MONTHLY_BUDGET_MINUTES
        ? Math.round((usedMinutes / MONTHLY_BUDGET_MINUTES) * 1000) / 10
        : 0;
      e.tasks.sort((a, b) => b.monthlyMinutes - a.monthlyMinutes);
      return {
        id: e.id,
        name: e.name,
        usedMinutes,
        remainingMinutes,
        monthlyBudgetMinutes: MONTHLY_BUDGET_MINUTES,
        utilizationPct,
        overBudgetMinutes: Math.max(0, usedMinutes - MONTHLY_BUDGET_MINUTES),
        taskCount: e.tasks.length,
        tasks: e.tasks,
      };
    })
    .sort((a, b) => {
      if (b.usedMinutes !== a.usedMinutes) return b.usedMinutes - a.usedMinutes;
      return a.name.localeCompare(b.name);
    });

  const totalUsed = employees.reduce((sum, e) => sum + e.usedMinutes, 0);
  const totalBudget = employees.length * MONTHLY_BUDGET_MINUTES;

  return {
    budgetYear: year,
    budgetMonth: month,
    monthlyBudgetMinutes: MONTHLY_BUDGET_MINUTES,
    employees,
    totals: {
      employeeCount: employees.length,
      totalBudgetMinutes: totalBudget,
      totalUsedMinutes: totalUsed,
      totalRemainingMinutes: Math.max(0, totalBudget - totalUsed),
      overBudgetEmployeeCount: employees.filter((e) => e.usedMinutes > MONTHLY_BUDGET_MINUTES).length,
    },
  };
}
