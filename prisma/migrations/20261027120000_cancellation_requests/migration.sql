ALTER TABLE "EventSeries" ADD COLUMN "suggestedFreeCancellationUntilMinutesBeforeStart" INTEGER;
ALTER TABLE "Event" ADD COLUMN "freeCancellationUntilMinutesBeforeStart" INTEGER;
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_cancellation_minutes_nonnegative" CHECK ("suggestedFreeCancellationUntilMinutesBeforeStart" >= 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_cancellation_minutes_nonnegative" CHECK ("freeCancellationUntilMinutesBeforeStart" >= 0);

CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "CancellationRefundStatus" AS ENUM ('NONE', 'PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW');
CREATE TABLE "CancellationRequest" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "customerReason" TEXT,
  "internalNote" TEXT,
  "automatic" BOOLEAN NOT NULL DEFAULT false,
  "refundStatus" "CancellationRefundStatus" NOT NULL DEFAULT 'NONE',
  "stripeRefundId" TEXT,
  "refundAttempt" INTEGER NOT NULL DEFAULT 0,
  "refundStartedAt" TIMESTAMP(3),
  "refundCheckedAt" TIMESTAMP(3),
  "refundLockedUntil" TIMESTAMP(3),
  "refundError" TEXT,
  CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CancellationRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CancellationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CancellationRequest_stripeRefundId_key" ON "CancellationRequest"("stripeRefundId");
-- Prisma cannot express this partial index. Keep it when creating future migrations.
-- Also disallow another request after approval, even if a legacy writer tries to
-- reinstate the booking. Rejected/withdrawn requests remain as immutable history.
CREATE UNIQUE INDEX "CancellationRequest_one_active_per_booking" ON "CancellationRequest"("bookingId") WHERE "status" IN ('PENDING', 'APPROVED');
CREATE INDEX "CancellationRequest_bookingId_requestedAt_idx" ON "CancellationRequest"("bookingId", "requestedAt");
CREATE INDEX "CancellationRequest_status_requestedAt_idx" ON "CancellationRequest"("status", "requestedAt");
CREATE INDEX "CancellationRequest_refundStatus_refundCheckedAt_idx" ON "CancellationRequest"("refundStatus", "refundCheckedAt");
CREATE TABLE "CancellationMail" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "encryptedMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CancellationMail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CancellationMail_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CancellationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CancellationMail_sentAt_createdAt_idx" ON "CancellationMail"("sentAt", "createdAt");
