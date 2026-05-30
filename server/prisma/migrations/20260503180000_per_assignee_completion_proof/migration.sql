-- Per-assignee proof and done flag; retire Task.completion_proof_path

ALTER TABLE `task_assignee` ADD COLUMN `completion_proof_path` VARCHAR(512) NULL;
ALTER TABLE `task_assignee` ADD COLUMN `assignee_done` BOOLEAN NOT NULL DEFAULT false;

-- Move legacy task-level proof to the lexicographically first assignee row per task (if any)
UPDATE `task_assignee` AS ta
INNER JOIN `Task` AS t ON t.id = ta.task_id
INNER JOIN (
  SELECT `task_id`, MIN(`user_id`) AS `user_id`
  FROM `task_assignee`
  GROUP BY `task_id`
) AS first_a ON first_a.task_id = ta.task_id AND first_a.user_id = ta.user_id
SET
  ta.`completion_proof_path` = t.`completion_proof_path`,
  ta.`assignee_done` = CASE WHEN t.`completed` = 1 THEN true ELSE ta.`assignee_done` END
WHERE t.`completion_proof_path` IS NOT NULL;

-- Task.completed: all assignees must be done when task has assignees
UPDATE `Task` AS t
LEFT JOIN (
  SELECT `task_id`,
    COUNT(*) AS `cnt`,
    SUM(CASE WHEN `assignee_done` = 1 THEN 1 ELSE 0 END) AS `done_cnt`
  FROM `task_assignee`
  GROUP BY `task_id`
) AS s ON s.`task_id` = t.`id`
SET t.`completed` = CASE
  WHEN s.`cnt` IS NULL OR s.`cnt` = 0 THEN t.`completed`
  WHEN s.`done_cnt` = s.`cnt` THEN 1
  ELSE 0
END;

ALTER TABLE `Task` DROP COLUMN `completion_proof_path`;
