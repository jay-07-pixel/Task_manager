ALTER TABLE `company_settings`
  ADD COLUMN `daily_check_in_time` VARCHAR(5) NULL,
  ADD COLUMN `daily_check_out_time` VARCHAR(5) NULL;

ALTER TABLE `attendance_check`
  ADD COLUMN `timing_status` VARCHAR(16) NULL;
