-- CreateTable
CREATE TABLE `task_deadline_extension_request` (
    `id` VARCHAR(191) NOT NULL,
    `task_id` VARCHAR(191) NOT NULL,
    `employee_user_id` VARCHAR(191) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('pending', 'approved') NOT NULL DEFAULT 'pending',
    `approved_at` DATETIME(3) NULL,
    `approved_by_user_id` VARCHAR(191) NULL,
    `new_due_at` DATETIME(3) NULL,

    INDEX `task_deadline_extension_request_task_id_employee_user_id_idx`(`task_id`, `employee_user_id`),
    INDEX `task_deadline_extension_request_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_deadline_extension_request` ADD CONSTRAINT `task_deadline_extension_request_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_deadline_extension_request` ADD CONSTRAINT `task_deadline_extension_request_employee_user_id_fkey` FOREIGN KEY (`employee_user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_deadline_extension_request` ADD CONSTRAINT `task_deadline_extension_request_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
