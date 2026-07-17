/**
 * One-shot: mark fully submitted tasks completed again (fixes inflated Active/Overdue).
 * Usage on VPS: cd ~/Task_manager/server && node scripts/restore-fully-submitted-completed.js
 */
import { PrismaClient } from "../prisma-client/index.js";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.$queryRaw`
    SELECT
      SUM(completed = 0) AS open_tasks,
      SUM(completed = 1) AS completed_tasks,
      COUNT(*) AS total
    FROM Task
  `;
  console.log("[restore] before", before);

  const result = await prisma.$executeRaw`
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
  console.log("[restore] rows updated", result);

  const after = await prisma.$queryRaw`
    SELECT
      SUM(completed = 0) AS open_tasks,
      SUM(completed = 1) AS completed_tasks,
      COUNT(*) AS total
    FROM Task
  `;
  console.log("[restore] after", after);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
