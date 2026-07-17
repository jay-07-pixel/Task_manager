/**
 * Delete duplicate recurring task cards created by the legacy backfill bug.
 *
 * For each (list, title, recurrence, due calendar day) keep ONE task and delete the rest.
 * That removes the ~2x inflation from spawn-on-restart without deleting unique real occurrences.
 *
 * Usage: cd ~/Task_manager/server && node scripts/delete-duplicate-recurring-tasks.js
 * Dry run: DRY_RUN=1 node scripts/delete-duplicate-recurring-tasks.js
 */
import { PrismaClient } from "../prisma-client/index.js";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";

function dueDayKey(dueAt) {
  if (!dueAt) return "none";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dueAt));
}

function assigneeScore(a) {
  let s = 0;
  if (a.assigneeDone) s += 20;
  if ((a.submissionText || "").trim()) s += 30;
  if (a.completionProofPath) s += 30;
  if ((a.lastSubmissionText || "").trim()) s += 10;
  if (a.lastCompletionProofPath) s += 10;
  return s;
}

function taskKeepScore(task) {
  let s = 0;
  if (task.completed) s += 5;
  for (const a of task.assignments ?? []) s += assigneeScore(a);
  // Prefer older card (original) when content is equal
  s += Math.max(0, 2_000_000_000 - Math.floor(new Date(task.createdAt).getTime() / 1000));
  return s;
}

async function counts() {
  return prisma.$queryRaw`
    SELECT
      SUM(completed = 0) AS open_tasks,
      SUM(completed = 1) AS completed_tasks,
      COUNT(*) AS total
    FROM Task
  `;
}

async function main() {
  console.log("[dedupe] mode:", DRY_RUN ? "DRY_RUN (no deletes)" : "DELETE");
  console.log("[dedupe] before", await counts());

  const tasks = await prisma.task.findMany({
    where: { recurrence: { not: "none" } },
    select: {
      id: true,
      listId: true,
      title: true,
      recurrence: true,
      dueAt: true,
      completed: true,
      createdAt: true,
      assignments: {
        select: {
          assigneeDone: true,
          submissionText: true,
          completionProofPath: true,
          lastSubmissionText: true,
          lastCompletionProofPath: true,
        },
      },
    },
  });

  /** @type {Map<string, typeof tasks>} */
  const groups = new Map();
  for (const t of tasks) {
    const key = `${t.listId}\0${t.title}\0${t.recurrence}\0${dueDayKey(t.dueAt)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const deleteIds = [];
  let groupsWithDupes = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    groupsWithDupes += 1;
    rows.sort((a, b) => taskKeepScore(b) - taskKeepScore(a));
    const keep = rows[0];
    for (const extra of rows.slice(1)) {
      deleteIds.push(extra.id);
      if (DRY_RUN) {
        console.log(
          `[dedupe] would delete ${extra.id} keep ${keep.id} | ${keep.title} | due ${dueDayKey(extra.dueAt)}`
        );
      }
    }
  }

  console.log("[dedupe] duplicate groups:", groupsWithDupes);
  console.log("[dedupe] tasks to remove:", deleteIds.length);

  if (!DRY_RUN && deleteIds.length) {
    // Delete in chunks to avoid huge IN lists
    const chunkSize = 200;
    let deleted = 0;
    for (let i = 0; i < deleteIds.length; i += chunkSize) {
      const chunk = deleteIds.slice(i, i + chunkSize);
      const result = await prisma.task.deleteMany({ where: { id: { in: chunk } } });
      deleted += result.count;
    }
    console.log("[dedupe] deleted:", deleted);
  }

  // Collapse leftover open recurring siblings (different due days, still open)
  if (!DRY_RUN) {
    const openRecurring = await prisma.task.findMany({
      where: { completed: false, recurrence: { not: "none" } },
      select: { id: true, listId: true, title: true, recurrence: true, dueAt: true, createdAt: true },
    });
    const openGroups = new Map();
    for (const t of openRecurring) {
      const key = `${t.listId}\0${t.title}\0${t.recurrence}`;
      if (!openGroups.has(key)) openGroups.set(key, []);
      openGroups.get(key).push(t);
    }
    const completeIds = [];
    for (const [, rows] of openGroups) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => {
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        if (bDue !== aDue) return bDue - aDue;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      for (const extra of rows.slice(1)) completeIds.push(extra.id);
    }
    if (completeIds.length) {
      const r = await prisma.task.updateMany({
        where: { id: { in: completeIds } },
        data: { completed: true },
      });
      console.log("[dedupe] extra open siblings marked completed:", r.count);
    }

    const restored = await prisma.$executeRaw`
      UPDATE Task AS t
      INNER JOIN (
        SELECT task_id,
          COUNT(*) AS cnt,
          SUM(CASE WHEN assignee_done = 1 THEN 1 ELSE 0 END) AS done_cnt
        FROM task_assignee
        GROUP BY task_id
      ) AS s ON s.task_id = t.id
      SET t.completed = true
      WHERE t.completed = false AND s.cnt > 0 AND s.done_cnt = s.cnt
    `;
    console.log("[dedupe] fully submitted → completed:", restored);
  }

  console.log("[dedupe] after", await counts());
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
