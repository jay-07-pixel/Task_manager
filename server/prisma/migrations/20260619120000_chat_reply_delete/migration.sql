-- AlterTable
ALTER TABLE `chat_message`
    ADD COLUMN `reply_to_message_id` VARCHAR(191) NULL,
    ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `chat_group_message`
    ADD COLUMN `reply_to_message_id` VARCHAR(191) NULL,
    ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `chat_message_reply_to_message_id_idx` ON `chat_message`(`reply_to_message_id`);

-- CreateIndex
CREATE INDEX `chat_group_message_reply_to_message_id_idx` ON `chat_group_message`(`reply_to_message_id`);

-- AddForeignKey
ALTER TABLE `chat_message` ADD CONSTRAINT `chat_message_reply_to_message_id_fkey` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_group_message` ADD CONSTRAINT `chat_group_message_reply_to_message_id_fkey` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_group_message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
