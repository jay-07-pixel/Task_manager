-- MySQL strict mode: TEXT columns cannot have a DEFAULT value.
ALTER TABLE `Task` MODIFY `notes` TEXT NOT NULL;
