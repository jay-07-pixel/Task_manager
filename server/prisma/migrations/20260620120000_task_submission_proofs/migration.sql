-- Multiple submission images per assignee
CREATE TABLE `task_submission_proof` (
    `id` VARCHAR(191) NOT NULL,
    `task_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `file_path` VARCHAR(512) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_submission_proof_task_id_user_id_archived_idx`(`task_id`, `user_id`, `archived`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `task_submission_proof` ADD CONSTRAINT `task_submission_proof_task_id_user_id_fkey` FOREIGN KEY (`task_id`, `user_id`) REFERENCES `task_assignee`(`task_id`, `user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `task_submission_proof` (`id`, `task_id`, `user_id`, `file_path`, `sort_order`, `archived`, `created_at`)
SELECT UUID(), `task_id`, `user_id`, `completion_proof_path`, 0, false, NOW(3)
FROM `task_assignee`
WHERE `completion_proof_path` IS NOT NULL;

INSERT INTO `task_submission_proof` (`id`, `task_id`, `user_id`, `file_path`, `sort_order`, `archived`, `created_at`)
SELECT UUID(), `task_id`, `user_id`, `last_completion_proof_path`, 0, true, NOW(3)
FROM `task_assignee`
WHERE `last_completion_proof_path` IS NOT NULL;
