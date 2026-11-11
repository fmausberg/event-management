ALTER TABLE "CompanyMembership"
  ADD COLUMN "notifyBookings" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyCancellationRequests" BOOLEAN NOT NULL DEFAULT true;

ALTER TYPE "MailOutboxKind" ADD VALUE 'COMPANY_NOTIFICATION';
