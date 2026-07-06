-- Preserve prior submission timestamp when admin reopens for resubmit.
ALTER TABLE `task_assignee` ADD COLUMN `archived_submitted_at` DATETIME(3) NULL;
