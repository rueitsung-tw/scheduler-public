-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN "subjectCodeMappings" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN "expertise_allocations" TEXT DEFAULT '[]';
ALTER TABLE "Teacher" ADD COLUMN "assignment_rules" TEXT DEFAULT '[]';
