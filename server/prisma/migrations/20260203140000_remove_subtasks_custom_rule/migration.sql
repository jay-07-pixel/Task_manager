DELETE FROM `Task` WHERE `parent_task_id` IS NOT NULL;

ALTER TABLE `Task` DROP FOREIGN KEY `Task_parent_task_id_fkey`;

DROP INDEX `Task_parent_task_id_idx` ON `Task`;

ALTER TABLE `Task` DROP COLUMN `parent_task_id`;

ALTER TABLE `Task` ADD COLUMN `recurrence_rule` TEXT NULL;
