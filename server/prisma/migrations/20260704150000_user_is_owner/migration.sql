-- AlterTable
ALTER TABLE `User` ADD COLUMN `is_owner` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: up to 2 oldest admins become company owners
UPDATE `User` u
INNER JOIN (
  SELECT `id`
  FROM `User`
  WHERE `is_admin` = true OR `role` = 'owner'
  ORDER BY `created_at` ASC
  LIMIT 2
) t ON u.`id` = t.`id`
SET u.`is_owner` = true;
