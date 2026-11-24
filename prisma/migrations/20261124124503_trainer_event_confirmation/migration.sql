-- CreateEnum
CREATE TYPE "TrainerResponseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'ISSUE');

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PENDING_TRAINER_CONFIRMATION';

-- AlterEnum
ALTER TYPE "MailOutboxKind" ADD VALUE 'TRAINER_CONFIRMATION';

-- AlterTable
ALTER TABLE "CompanyMembership" ADD COLUMN     "notifyTrainerIssues" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "EventTrainer" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "responseStatus" "TrainerResponseStatus" NOT NULL DEFAULT 'PENDING';
