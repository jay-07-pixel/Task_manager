-- Previously, full assignee submission auto-set Task.completed = true.
-- Owner review is now explicit: keep assignee_done, clear completed so these
-- tasks appear under Submitted until an admin marks them Reviewed.
UPDATE `Task` AS t
INNER JOIN (
  SELECT
    `task_id`,
    COUNT(*) AS `cnt`,
    SUM(CASE WHEN `assignee_done` = 1 THEN 1 ELSE 0 END) AS `done_cnt`
  FROM `task_assignee`
  GROUP BY `task_id`
) AS s ON s.`task_id` = t.`id`
SET t.`completed` = false
WHERE t.`completed` = true
  AND s.`cnt` > 0
  AND s.`done_cnt` = s.`cnt`;
