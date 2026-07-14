-- CreateTable
CREATE TABLE `task_progress_update_attachment` (
    `id` VARCHAR(191) NOT NULL,
    `update_id` VARCHAR(191) NOT NULL,
    `file_path` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(128) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `original_name` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_progress_update_attachment_update_id_idx`(`update_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `task_progress_update_attachment` ADD CONSTRAINT `task_progress_update_attachment_update_id_fkey` FOREIGN KEY (`update_id`) REFERENCES `task_progress_update`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
