-- Pin user lists to top of "Your lists" sidebar
ALTER TABLE `TaskList` ADD COLUMN `pinned` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `TaskList` ADD COLUMN `pinned_at` DATETIME(3) NULL;
