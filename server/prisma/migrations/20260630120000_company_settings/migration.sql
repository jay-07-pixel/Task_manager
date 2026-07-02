-- CreateTable
CREATE TABLE `company_settings` (
    `id` VARCHAR(191) NOT NULL,
    `trial_start_date` DATETIME(3) NOT NULL,
    `trial_end_date` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
