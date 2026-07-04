-- AlterTable
ALTER TABLE `User` ADD COLUMN `profile_photo_path` VARCHAR(512) NULL,
    ADD COLUMN `profile_photo_mime` VARCHAR(128) NULL,
    ADD COLUMN `profile_photo_name` VARCHAR(255) NULL,
    ADD COLUMN `id_proof_path` VARCHAR(512) NULL,
    ADD COLUMN `id_proof_mime` VARCHAR(128) NULL,
    ADD COLUMN `id_proof_name` VARCHAR(255) NULL;
