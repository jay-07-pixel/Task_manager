-- CreateTable
CREATE TABLE `task_progress_update_read` (
    `task_id` VARCHAR(191) NOT NULL,
    `assignee_user_id` VARCHAR(191) NOT NULL,
    `owner_id` VARCHAR(191) NOT NULL,
    `last_read_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`task_id`, `assignee_user_id`, `owner_id`),
    CONSTRAINT `task_progress_update_read_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `task_progress_update_read_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
