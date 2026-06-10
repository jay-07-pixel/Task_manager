-- AlterTable
ALTER TABLE `task_assignee` ADD COLUMN `last_submission_text` TEXT NULL,
    ADD COLUMN `last_completion_proof_path` VARCHAR(512) NULL;
