-- Attendance start date: days before this date are excluded from absent/present reporting.
ALTER TABLE `company_settings`
  ADD COLUMN `attendance_start_date` VARCHAR(10) NULL;
