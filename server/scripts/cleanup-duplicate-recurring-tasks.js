/**
 * Cleanup inflated open/overdue counts and recurring duplicate cards.
 *
 * 1) Mark fully submitted open tasks as completed (Reviewed).
 * 2) For each open recurring series (same list + title + recurrence), keep only the
 *    card with the latest due date; mark older open siblings completed.
 *
 * Usage: cd ~/Task_manager/server && node scripts/cleanup-duplicate-recurring-tasks.js
 */
import { PrismaClient } from "../prisma-client/index.js";

const prisma = new PrismaClient();

async function counts() {
  return prisma.$queryRaw`
    SELECT
      SUM(completed = 0) AS open_tasks,
      SUM(completed = 1) AS completed_tasks,
      COUNT(*) AS total
    FROM Task
  `;
}

async function restoreFullySubmitted() {
  return prisma.$executeRaw`
    UPDATE Task AS t
    INNER JOIN (
      SELECT
        task_id,
        COUNT(*) AS cnt,
        SUM(CASE WHEN assignee_done = 1 THEN 1 ELSE 0 END) AS done_cnt
      FROM task_assignee
      GROUP BY task_id
    ) AS s ON s.task_id = t.id
    SET t.completed = true
    WHERE t.completed = false
      AND s.cnt > 0
      AND s.done_cnt = s.cnt
  `;
}

async function collapseOpenRecurringDuplicates() {
  const openRecurring = await prisma.task.findMany({
    where: {
      completed: false,
      recurrence: { not: "none" },
    },
    select: {
      id: true,
      listId: true,
      title: true,
      recurrence: true,
      dueAt: true,
      createdAt: true,
    },
  });

  /** @type {Map<string, typeof openRecurring>} */
  const groups = new Map();
  for (const t of openRecurring) {
    const key = `${t.listId}\0${t.title}\0${t.recurrence}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const toComplete = [];
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : 0;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : 0;
      if (bDue !== aDue) return bDue - aDue;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    // Keep latest due; complete the rest (duplicate past occurrences).
    for (const extra of rows.slice(1)) {
      toComplete.push(extra.id);
    }
  }

  if (!toComplete.length) return 0;

  const result = await prisma.task.updateMany({
    where: { id: { in: toComplete } },
    data: { completed: true },
  });
  return result.count;
}

async function main() {
  console.log("[cleanup] before", await counts());

  const restored = await restoreFullySubmitted();
  console.log("[cleanup] fully submitted → completed:", restored);

  const collapsed = await collapseOpenRecurringDuplicates();
  console.log("[cleanup] duplicate open recurring → completed:", collapsed);

  // Second pass: after collapsing, any remaining all-done open cards
  const restoredAgain = await restoreFullySubmitted();
  console.log("[cleanup] fully submitted (2nd pass):", restoredAgain);

  console.log("[cleanup] after", await counts());
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
