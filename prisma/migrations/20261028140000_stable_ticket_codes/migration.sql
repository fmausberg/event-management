-- Intentionally no default/backfill: old hashes cannot recover ticket secrets.
-- If Ticket contains disposable test data, the operator must clear it first.
-- This migration never deletes data or generates replacement codes.
ALTER TABLE "Ticket" ADD COLUMN "encryptedPublicToken" TEXT NOT NULL;
