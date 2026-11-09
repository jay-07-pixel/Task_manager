-- AlterTable: checkout blocked until today's tasks are done + optional daily task email report
ALTER TABLE `company_settings` ADD COLUMN `checkout_requires_tasks_done` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `company_settings` ADD COLUMN `daily_task_report_time` VARCHAR(5) NULL;
ALTER TABLE `company_settings` ADD COLUMN `daily_task_report_last_sent_on` VARCHAR(10) NULL;
