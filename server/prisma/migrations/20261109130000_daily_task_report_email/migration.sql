-- AlterTable: recipient email for daily task completion report
ALTER TABLE `company_settings` ADD COLUMN `daily_task_report_email` VARCHAR(191) NULL;
