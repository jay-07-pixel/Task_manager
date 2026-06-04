-- Phase 8.2: Android FCM device registration (employee_device)
CREATE TABLE `employee_device` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(64) NOT NULL,
    `fcm_token` VARCHAR(512) NOT NULL,
    `platform` VARCHAR(16) NOT NULL DEFAULT 'android',
    `app_version` VARCHAR(32) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `employee_device_device_id_key`(`device_id`),
    INDEX `employee_device_user_id_idx`(`user_id`),
    INDEX `employee_device_fcm_token_idx`(`fcm_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_device` ADD CONSTRAINT `employee_device_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
