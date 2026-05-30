-- AlterTable
ALTER TABLE `Task` ADD COLUMN `all_day` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `recurrence` ENUM('none', 'daily', 'weekly', 'monthly', 'yearly', 'custom') NOT NULL DEFAULT 'none';
