-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN "preallocEvents" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "SystemSetting" ADD COLUMN "preallocEventSettings" TEXT NOT NULL DEFAULT '{}';