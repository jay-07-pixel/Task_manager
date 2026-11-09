import { prisma } from "../lib/prisma.js";
import { adminUserWhere } from "../lib/adminUsers.js";
import { parseTimeHHmm } from "../lib/attendanceSchedule.js";
import { sendDailyTaskStatusReportEmail } from "../lib/mail.js";
import {
  getCheckoutTaskGateSettings,
  isCheckoutRequiresTasksDone,
  isCompanyAttendanceEnabled,
  markDailyTaskReportSent,
} from "./companyAttendanceSettings.js";

function startOfDayLocal(dateStr) {
  let start;
  if (dateStr) {
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error("Invalid date");
    start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(start.getTime())) throw new Error("Invalid date");
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function serializeAssignment(row) {
  const dueAt = row.task?.dueAt ?? null;
  return {
    taskId: row.taskId,
    title: row.task?.title || "Untitled task",
    dueAt: dueAt ? dueAt.toISOString() : null,
    employeeId: row.userId,
    employeeName: row.user?.displayName || row.user?.email || "Employee",
    employeeEmail: row.user?.email || null,
    completed: row.assigneeDone === true,
  };
}

/**
 * Tasks due today for one employee, plus past incomplete (due before today or undated).
 * @param {string} userId
 * @param {string} [dateKey]
 */
export async function getEmployeeTaskCheckoutSummary(userId, dateKey) {
  const { start, end } = startOfDayLocal(dateKey);
  const rows = await prisma.taskAssignee.findMany({
    where: {
      userId,
      task: {
        OR: [
          { dueAt: { gte: start, lt: end } },
          { dueAt: { lt: start } },
          { dueAt: null },
        ],
      },
    },
    include: {
      task: { select: { id: true, title: true, dueAt: true } },
      user: { select: { id: true, displayName: true, email: true } },
    },
  });

  const todayCompleted = [];
  const todayIncomplete = [];
  const pastIncomplete = [];

  for (const row of rows) {
    const item = serializeAssignment(row);
    const dueAt = row.task?.dueAt;
    if (dueAt && dueAt >= start && dueAt < end) {
      if (row.assigneeDone) todayCompleted.push(item);
      else todayIncomplete.push(item);
      continue;
    }
    if (!row.assigneeDone) {
      pastIncomplete.push(item);
    }
  }

  return {
    date: localDateKey(start),
    todayCompleted,
    todayIncomplete,
    pastIncomplete,
    todayTotal: todayCompleted.length + todayIncomplete.length,
    canCheckout: todayIncomplete.length === 0,
  };
}

/**
 * @param {string} userId
 * @throws {Error}
 */
export async function assertEmployeeCanCheckout(userId) {
  if (!(await isCheckoutRequiresTasksDone())) return null;
  const summary = await getEmployeeTaskCheckoutSummary(userId);
  if (summary.canCheckout) return summary;
  const n = summary.todayIncomplete.length;
  const titles = summary.todayIncomplete
    .slice(0, 3)
    .map((t) => t.title)
    .join(", ");
  const more = n > 3 ? ` (+${n - 3} more)` : "";
  throw new Error(
    n === 1
      ? `Complete your remaining task before check-out: ${titles}.`
      : `Complete all ${n} remaining tasks before check-out: ${titles}${more}.`
  );
}

/**
 * Company-wide snapshot for the daily admin email.
 * @param {string} [dateKey]
 */
export async function buildDailyTaskStatusReport(dateKey) {
  const { start, end } = startOfDayLocal(dateKey);
  const date = localDateKey(start);

  const rows = await prisma.taskAssignee.findMany({
    where: {
      task: {
        OR: [
          { dueAt: { gte: start, lt: end } },
          { dueAt: { lt: start } },
          { dueAt: null },
        ],
      },
      user: {
        isAdmin: false,
        isOwner: false,
        NOT: { role: "owner" },
      },
    },
    include: {
      task: { select: { id: true, title: true, dueAt: true } },
      user: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: [{ user: { displayName: "asc" } }, { task: { title: "asc" } }],
  });

  const todayCompleted = [];
  const todayIncomplete = [];
  const pastIncomplete = [];

  for (const row of rows) {
    const item = serializeAssignment(row);
    const dueAt = row.task?.dueAt;
    if (dueAt && dueAt >= start && dueAt < end) {
      if (row.assigneeDone) todayCompleted.push(item);
      else todayIncomplete.push(item);
      continue;
    }
    if (!row.assigneeDone) pastIncomplete.push(item);
  }

  return { date, todayCompleted, todayIncomplete, pastIncomplete };
}

async function listAdminRecipients() {
  return prisma.user.findMany({
    where: adminUserWhere,
    select: { id: true, email: true, displayName: true },
  });
}

/**
 * Send today's task completion report to all admins (idempotent per calendar day).
 */
export async function runDailyTaskReportTick(now = new Date()) {
  if (!(await isCompanyAttendanceEnabled())) {
    return { skipped: true, reason: "attendance_off" };
  }
  const settings = await getCheckoutTaskGateSettings();
  if (!settings.checkoutRequiresTasksDone) return { skipped: true, reason: "feature_off" };
  if (!settings.dailyTaskReportTime) return { skipped: true, reason: "no_time" };

  const parsed = parseTimeHHmm(settings.dailyTaskReportTime);
  if (!parsed) return { skipped: true, reason: "invalid_time" };

  const dateKey = localDateKey(now);
  if (settings.dailyTaskReportLastSentOn === dateKey) {
    return { skipped: true, reason: "already_sent" };
  }

  const minsNow = now.getHours() * 60 + now.getMinutes();
  const target = parsed.hours * 60 + parsed.minutes;
  if (minsNow < target) return { skipped: true, reason: "too_early" };

  const report = await buildDailyTaskStatusReport(dateKey);
  const admins = await listAdminRecipients();
  const withEmail = admins.filter((a) => a.email?.trim());
  if (!withEmail.length) {
    await markDailyTaskReportSent(dateKey);
    return { skipped: true, reason: "no_admins" };
  }

  let sent = 0;
  for (const admin of withEmail) {
    try {
      const result = await sendDailyTaskStatusReportEmail({
        to: admin.email,
        recipientName: admin.displayName || "Admin",
        report,
      });
      if (result?.ok !== false) sent += 1;
    } catch (err) {
      console.error("[daily-task-report] email failed", admin.email, err);
    }
  }

  await markDailyTaskReportSent(dateKey);
  return {
    ok: true,
    date: dateKey,
    sent,
    todayCompleted: report.todayCompleted.length,
    todayIncomplete: report.todayIncomplete.length,
    pastIncomplete: report.pastIncomplete.length,
  };
}

let dailyTaskReportTimer = null;

export function startDailyTaskReportScheduler() {
  if (dailyTaskReportTimer) return dailyTaskReportTimer;
  console.log("[daily-task-report] scheduler started (every 60s)");
  void runDailyTaskReportTick().catch((err) => console.error("[daily-task-report]", err));
  dailyTaskReportTimer = setInterval(() => {
    runDailyTaskReportTick().catch((err) => console.error("[daily-task-report]", err));
  }, 60 * 1000);
  return dailyTaskReportTimer;
}
