-- CreateEnum
CREATE TYPE "EventReviewStatus" AS ENUM ('PROVISIONAL', 'COMPLETED');

-- AlterEnum
ALTER TYPE "MailOutboxKind" ADD VALUE 'EVENT_REVIEW';

-- AlterTable
ALTER TABLE "MailOutbox" ADD COLUMN     "encryptedMessage" TEXT,
ADD COLUMN     "reviewId" TEXT;

-- CreateTable
CREATE TABLE "EventReview" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "status" "EventReviewStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "overallRating" INTEGER,
    "trainerRating" INTEGER,
    "locationRating" INTEGER,
    "organizationRating" INTEGER,
    "overallComment" VARCHAR(2000),
    "trainerComment" VARCHAR(2000),
    "locationComment" VARCHAR(2000),
    "organizationComment" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventReview_tokenHash_key" ON "EventReview"("tokenHash");

-- CreateIndex
CREATE INDEX "EventReview_eventId_status_idx" ON "EventReview"("eventId", "status");

-- CreateIndex
CREATE INDEX "EventReview_bookingId_idx" ON "EventReview"("bookingId");

-- CreateIndex
CREATE INDEX "EventReview_ticketId_idx" ON "EventReview"("ticketId");

-- CreateIndex
CREATE INDEX "EventReview_expiresAt_idx" ON "EventReview"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventReview_eventId_recipientEmail_key" ON "EventReview"("eventId", "recipientEmail");

-- CreateIndex
CREATE UNIQUE INDEX "MailOutbox_reviewId_key" ON "MailOutbox"("reviewId");

-- AddForeignKey
ALTER TABLE "MailOutbox" ADD CONSTRAINT "MailOutbox_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "EventReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReview" ADD CONSTRAINT "EventReview_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReview" ADD CONSTRAINT "EventReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReview" ADD CONSTRAINT "EventReview_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULL means unanswered, never zero. Final submissions require an overall score.
ALTER TABLE "EventReview"
  ADD CONSTRAINT "EventReview_overall_range" CHECK ("overallRating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "EventReview_trainer_range" CHECK ("trainerRating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "EventReview_location_range" CHECK ("locationRating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "EventReview_organization_range" CHECK ("organizationRating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "EventReview_status_consistent" CHECK (
    (status = 'PROVISIONAL' AND "submittedAt" IS NULL) OR
    (status = 'COMPLETED' AND "submittedAt" IS NOT NULL AND "overallRating" IS NOT NULL)),
  ADD CONSTRAINT "EventReview_normalized_email" CHECK ("recipientEmail" = lower(trim("recipientEmail")));
