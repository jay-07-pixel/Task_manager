-- Force-restore completed for fully submitted tasks (in case the prior restore
-- migration was marked applied without updating this database).
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
