-- Team chat: 1:1 conversations between employees and admins

CREATE TABLE `chat_conversation` (
    `id` VARCHAR(191) NOT NULL,
    `user_low_id` VARCHAR(191) NOT NULL,
    `user_high_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chat_conversation_user_low_id_user_high_id_key`(`user_low_id`, `user_high_id`),
    INDEX `chat_conversation_user_low_id_idx`(`user_low_id`),
    INDEX `chat_conversation_user_high_id_idx`(`user_high_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_message` (
    `id` VARCHAR(191) NOT NULL,
    `conversation_id` VARCHAR(191) NOT NULL,
    `sender_id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `read_at` DATETIME(3) NULL,

    INDEX `chat_message_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `chat_conversation` ADD CONSTRAINT `chat_conversation_user_low_id_fkey` FOREIGN KEY (`user_low_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_conversation` ADD CONSTRAINT `chat_conversation_user_high_id_fkey` FOREIGN KEY (`user_high_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_message` ADD CONSTRAINT `chat_message_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_message` ADD CONSTRAINT `chat_message_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
