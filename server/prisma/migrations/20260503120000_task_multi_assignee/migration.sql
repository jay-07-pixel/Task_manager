-- CreateTable
CREATE TABLE `task_assignee` (
    `task_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`task_id`, `user_id`),
    INDEX `task_assignee_user_id_idx`(`user_id`),
    CONSTRAINT `task_assignee_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `task_assignee_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `task_assignee` (`task_id`, `user_id`)
SELECT `id`, `assignee_id` FROM `Task` WHERE `assignee_id` IS NOT NULL;

ALTER TABLE `Task` DROP FOREIGN KEY `Task_assignee_id_fkey`;
DROP INDEX `Task_assignee_id_idx` ON `Task`;
ALTER TABLE `Task` DROP COLUMN `assignee_id`;
