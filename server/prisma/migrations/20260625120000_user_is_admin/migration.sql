-- Admin access flag: users stay employees in DB but can also use admin dashboard.
ALTER TABLE `User` ADD COLUMN `is_admin` BOOLEAN NOT NULL DEFAULT false;

UPDATE `User` SET `is_admin` = true WHERE `role` = 'owner';
