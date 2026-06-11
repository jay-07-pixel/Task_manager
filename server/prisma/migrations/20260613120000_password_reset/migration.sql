-- CreateTable
CREATE TABLE `password_reset` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `otp_hash` VARCHAR(255) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `resend_count` INTEGER NOT NULL DEFAULT 0,
    `resend_window_start` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `password_reset_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
