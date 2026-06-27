-- AlterTable
ALTER TABLE `chat_message` ADD COLUMN `forwarded_from_name` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `chat_group_message` ADD COLUMN `forwarded_from_name` VARCHAR(120) NULL;
