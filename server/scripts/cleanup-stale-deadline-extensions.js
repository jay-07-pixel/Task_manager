/**
 * Cancel stale deadline-extension (postpone) requests that should not show for admins.
 * Stale = task completed, employee already submitted, or no longer 6+ days overdue.
 *
 * Usage: cd ~/Task_manager/server && node scripts/cleanup-stale-deadline-extensions.js
 */
import { PrismaClient } from "../prisma-client/index.js";

const prisma = new PrismaClient();
const CRITICAL_OVERDUE_MIN_DAYS = 6;

function overdueDays(dueAt) {
  if (!dueAt) return 0;
  const diffMs = Date.now() - new Date(dueAt).getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 86_400_000);
}

async function main() {
  const pending = await prisma.taskDeadlineExtensionRequest.findMany({
    where: { status: "pending" },
    include: {
      task: {
        select: {
          id: true,
          completed: true,
          dueAt: true,
          title: true,
          assignments: { select: { userId: true, assigneeDone: true } },
        },
      },
    },
  });

  console.log("[deadline-ext] pending before:", pending.length);

  const staleIds = [];
  for (const row of pending) {
    const task = row.task;
    if (!task || task.completed) {
      staleIds.push(row.id);
      continue;
    }
    if (!task.dueAt || overdueDays(task.dueAt) < CRITICAL_OVERDUE_MIN_DAYS) {
      staleIds.push(row.id);
      continue;
    }
    const assignment = (task.assignments ?? []).find((a) => a.userId === row.employeeUserId);
    if (!assignment || assignment.assigneeDone) {
      staleIds.push(row.id);
    }
  }

  console.log("[deadline-ext] stale to cancel:", staleIds.length);

  if (staleIds.length) {
    const result = await prisma.taskDeadlineExtensionRequest.updateMany({
      where: { id: { in: staleIds }, status: "pending" },
      data: { status: "cancelled" },
    });
    console.log("[deadline-ext] cancelled:", result.count);
  }

  const remaining = await prisma.taskDeadlineExtensionRequest.count({
    where: { status: "pending" },
  });
  console.log("[deadline-ext] pending after:", remaining);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
