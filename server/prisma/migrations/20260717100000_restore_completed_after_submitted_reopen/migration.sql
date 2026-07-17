-- Undo 20260716190000_reopen_submitted_awaiting_owner_review for historical work.
-- That backfill reopened every fully submitted task (including old completed cards and
-- already-rolled recurring occurrences), which roughly doubled open task counts.
-- Restore completed=true when every assignee has submitted. New submissions after the
-- sync change still stay completed=false until an owner clicks Mark as reviewed.
UPDATE `Task` AS t
INNER JOIN (
  SELECT
    `task_id`,
    COUNT(*) AS `cnt`,
    SUM(CASE WHEN `assignee_done` = 1 THEN 1 ELSE 0 END) AS `done_cnt`
  FROM `task_assignee`
  GROUP BY `task_id`
) AS s ON s.`task_id` = t.`id`
SET t.`completed` = true
WHERE t.`completed` = false
  AND s.`cnt` > 0
  AND s.`done_cnt` = s.`cnt`;
