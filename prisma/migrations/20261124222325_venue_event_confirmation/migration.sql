-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PENDING_VENUE_CONFIRMATION';

-- AlterEnum
ALTER TYPE "MailOutboxKind" ADD VALUE 'VENUE_CONFIRMATION';

-- AlterTable
ALTER TABLE "CompanyMembership" ADD COLUMN     "notifyVenueIssues" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "EventVenueApproval" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "venueId" TEXT,
    "status" "TrainerResponseStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventVenueApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventVenueApproval_eventId_key" ON "EventVenueApproval"("eventId");

-- CreateIndex
CREATE INDEX "EventVenueApproval_batchId_status_idx" ON "EventVenueApproval"("batchId", "status");

-- CreateIndex
CREATE INDEX "EventVenueApproval_venueId_status_idx" ON "EventVenueApproval"("venueId", "status");

-- AddForeignKey
ALTER TABLE "EventVenueApproval" ADD CONSTRAINT "EventVenueApproval_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenueApproval" ADD CONSTRAINT "EventVenueApproval_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
