-- AlterTable
ALTER TABLE "SpecialCourse" ADD COLUMN "semanticVersion" INTEGER DEFAULT 1;
ALTER TABLE "SpecialCourse" ADD COLUMN "pulloutLabelSubject" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "classAnchorSubject" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "deliveryCourseName" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "participantGroupId" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "teacherAssignmentMode" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "sourceAnchor" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "legalTimeWindow" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "timePolicy" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "anchorPriority" TEXT;
ALTER TABLE "SpecialCourse" ADD COLUMN "classSubjectSynchronization" TEXT;
