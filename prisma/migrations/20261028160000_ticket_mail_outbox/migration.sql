-- Deploy with app/cron workers stopped and SMTP operations drained.
-- Rename/backfill in place: preserve all existing payloads, sent markers and leases.
BEGIN;
ALTER TABLE "PaymentMail" RENAME TO "TicketMail";
ALTER TABLE "TicketMail" ADD COLUMN "id" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "bookingId" TEXT,
  ADD COLUMN "requestedById" TEXT,
  ADD COLUMN "lockToken" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastError" TEXT;
UPDATE "TicketMail" m SET "id" = m."paymentId", "bookingId" = p."bookingId",
  "requestKey" = 'initial:' || p."bookingId" FROM "Payment" p WHERE p."id" = m."paymentId";
ALTER TABLE "TicketMail" DROP CONSTRAINT "PaymentMail_pkey";
ALTER TABLE "TicketMail" ALTER COLUMN "paymentId" DROP NOT NULL,
  ALTER COLUMN "id" SET NOT NULL, ALTER COLUMN "bookingId" SET NOT NULL,
  ALTER COLUMN "requestKey" SET NOT NULL;
ALTER TABLE "TicketMail" ADD CONSTRAINT "TicketMail_pkey" PRIMARY KEY ("id");
ALTER TABLE "TicketMail" RENAME CONSTRAINT "PaymentMail_paymentId_fkey" TO "TicketMail_paymentId_fkey";
CREATE UNIQUE INDEX "TicketMail_paymentId_key" ON "TicketMail"("paymentId");
CREATE UNIQUE INDEX "TicketMail_requestKey_key" ON "TicketMail"("requestKey");
CREATE INDEX "TicketMail_sentAt_availableAt_createdAt_idx" ON "TicketMail"("sentAt", "availableAt", "createdAt");
CREATE INDEX "TicketMail_bookingId_createdAt_idx" ON "TicketMail"("bookingId", "createdAt");
ALTER TABLE "TicketMail" ADD CONSTRAINT "TicketMail_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketMail" ADD CONSTRAINT "TicketMail_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
