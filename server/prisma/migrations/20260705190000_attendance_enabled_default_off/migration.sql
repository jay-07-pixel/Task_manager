-- AlterTable: attendance is opt-in (off by default)
ALTER TABLE `company_settings` MODIFY COLUMN `attendance_enabled` BOOLEAN NOT NULL DEFAULT false;

-- Existing companies should start with attendance disabled until admin turns it on
UPDATE `company_settings` SET `attendance_enabled` = false;
