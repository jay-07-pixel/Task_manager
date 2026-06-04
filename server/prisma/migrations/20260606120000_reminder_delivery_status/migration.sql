-- Extend reminder_sent: per-channel dedup + delivery status (FCM and web push)
ALTER TABLE `reminder_sent`
    ADD COLUMN `channel` VARCHAR(16) NOT NULL DEFAULT 'web_push' AFTER `slot`,
    ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'sent' AFTER `channel`,
    ADD COLUMN `message_id` VARCHAR(128) NULL AFTER `status`,
    ADD COLUMN `error_message` TEXT NULL AFTER `message_id`;

ALTER TABLE `reminder_sent` DROP PRIMARY KEY,
    ADD PRIMARY KEY (`task_id`, `user_id`, `due_at`, `slot`, `channel`);
