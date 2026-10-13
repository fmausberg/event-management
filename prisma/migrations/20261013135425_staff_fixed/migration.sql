/*
  Warnings:

  - A unique constraint covering the columns `[eventId,email]` on the table `EventStaff` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "EventStaff" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EventStaff_eventId_email_key" ON "EventStaff"("eventId", "email");
