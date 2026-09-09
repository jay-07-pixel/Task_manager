-- AlterTable: task assignment emails are opt-in (off by default)
ALTER TABLE `company_settings` ADD COLUMN `task_assignment_email_enabled` BOOLEAN NOT NULL DEFAULT false;
