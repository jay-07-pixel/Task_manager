-- Per-assignee submission notes (text-only, image-only, or both)

ALTER TABLE `task_assignee` ADD COLUMN `submission_text` TEXT NULL;
