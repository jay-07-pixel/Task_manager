-- Chat message attachments (DM + group)
ALTER TABLE `chat_message`
    ADD COLUMN `attachment_path` VARCHAR(255) NULL AFTER `body`,
    ADD COLUMN `attachment_mime` VARCHAR(128) NULL AFTER `attachment_path`,
    ADD COLUMN `attachment_name` VARCHAR(255) NULL AFTER `attachment_mime`;

ALTER TABLE `chat_group_message`
    ADD COLUMN `attachment_path` VARCHAR(255) NULL AFTER `body`,
    ADD COLUMN `attachment_mime` VARCHAR(128) NULL AFTER `attachment_path`,
    ADD COLUMN `attachment_name` VARCHAR(255) NULL AFTER `attachment_mime`;
