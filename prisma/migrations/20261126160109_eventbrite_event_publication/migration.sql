-- CreateEnum
CREATE TYPE "EventbritePublicationStatus" AS ENUM ('PENDING', 'PROCESSING', 'ERROR', 'UNCERTAIN', 'PUBLISHED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "postToEventbrite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventbritePublication" (
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "EventbritePublicationStatus" NOT NULL DEFAULT 'PENDING',
    "externalEventId" TEXT,
    "ticketClassId" TEXT,
    "venueId" TEXT,
    "lastError" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventbritePublication_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventbritePublication_externalEventId_key" ON "EventbritePublication"("externalEventId");

-- CreateIndex
CREATE INDEX "EventbritePublication_status_createdAt_idx" ON "EventbritePublication"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EventbritePublication" ADD CONSTRAINT "EventbritePublication_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
