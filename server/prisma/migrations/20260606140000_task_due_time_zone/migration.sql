-- Store IANA timezone used when owner set due date/time (for correct reminder display on UTC VPS)
ALTER TABLE `task`
    ADD COLUMN `due_time_zone` VARCHAR(64) NULL AFTER `all_day`;
