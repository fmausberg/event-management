BEGIN;
-- Scope external identity to the event owner; backfill before replacing uniqueness.
ALTER TABLE "Booking" ADD COLUMN "externalCompanyId" TEXT;
UPDATE "Booking" b SET "externalCompanyId" = e."companyId" FROM "Event" e WHERE b."eventId" = e.id AND b.platform IS NOT NULL;
DROP INDEX "Booking_platform_externalBookingId_key";
CREATE UNIQUE INDEX "Booking_externalCompanyId_platform_externalBookingId_key" ON "Booking"("externalCompanyId", "platform", "externalBookingId");
CREATE FUNCTION "booking_external_company"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT "companyId" INTO NEW."externalCompanyId" FROM "Event" WHERE id = NEW."eventId";
  RETURN NEW;
END; $$;
CREATE TRIGGER "Booking_external_company" BEFORE INSERT OR UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION "booking_external_company"();
-- Prevent a tenant move from leaving identity/history associated with the old tenant.
CREATE FUNCTION "event_import_company_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."companyId" IS DISTINCT FROM OLD."companyId" AND (
    EXISTS (SELECT 1 FROM "Booking" WHERE "eventId" = OLD.id)
    OR EXISTS (SELECT 1 FROM "BookingImportRow" WHERE "eventId" = OLD.id)
  ) THEN
    RAISE EXCEPTION 'Events with bookings cannot change company';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Event_booking_company_guard" BEFORE UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION "event_import_company_guard"();
CREATE TABLE "BookingImport" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
  platform "Platform" NOT NULL, name VARCHAR(160) NOT NULL, "fileName" VARCHAR(255) NOT NULL,
  "sheetName" VARCHAR(160) NOT NULL, "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "startedAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3) NOT NULL,
  "rowCount" INTEGER NOT NULL, "importedCount" INTEGER NOT NULL, "duplicateCount" INTEGER NOT NULL,
  "excludedCount" INTEGER NOT NULL, "errorCount" INTEGER NOT NULL, mapping JSONB NOT NULL, "rawDeletedAt" TIMESTAMP(3)
);
CREATE INDEX "BookingImport_companyId_completedAt_idx" ON "BookingImport"("companyId", "completedAt");
CREATE TABLE "BookingImportRow" (
  id TEXT PRIMARY KEY, "importId" TEXT NOT NULL REFERENCES "BookingImport"(id) ON DELETE RESTRICT,
  "sourceRow" INTEGER NOT NULL, raw JSONB, normalized JSONB,
  "eventId" TEXT REFERENCES "Event"(id) ON DELETE RESTRICT,
  "bookingId" TEXT REFERENCES "Booking"(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('IMPORTED','DUPLICATE','EXCLUDED','ERROR')),
  messages TEXT[] NOT NULL,
  CONSTRAINT "BookingImportRow_raw_size" CHECK (octet_length(raw::text) <= 32768),
  CONSTRAINT "BookingImportRow_normalized_size" CHECK (octet_length(normalized::text) <= 32768)
);
CREATE UNIQUE INDEX "BookingImportRow_bookingId_key" ON "BookingImportRow"("bookingId");
CREATE UNIQUE INDEX "BookingImportRow_importId_sourceRow_key" ON "BookingImportRow"("importId", "sourceRow");
CREATE INDEX "BookingImportRow_eventId_idx" ON "BookingImportRow"("eventId");
-- Version 2 snapshots record external gross totals, including indivisible per-seat cents.
-- Existing version 1 snapshots and append-only protection are unchanged.
ALTER TABLE "BookingPrice" DROP CONSTRAINT "BookingPrice_amount_check";
ALTER TABLE "BookingPrice" ADD CONSTRAINT "BookingPrice_amount_check" CHECK (
  "unitPriceMinor" >= 0 AND quantity > 0 AND "originalAmountMinor" >= 0
  AND "discountAmountMinor" >= 0 AND "voucherAmountMinor" >= 0 AND "payableAmountMinor" >= 0
  AND "originalAmountMinor"::bigint = "discountAmountMinor"::bigint + "voucherAmountMinor"::bigint + "payableAmountMinor"::bigint
  AND (("calculationVersion" <> 2 AND "originalAmountMinor"::bigint = "unitPriceMinor"::bigint * quantity::bigint AND currency = 'EUR')
    OR ("calculationVersion" = 2 AND "unitPriceMinor" = "originalAmountMinor" / quantity AND "discountAmountMinor" = 0 AND "voucherAmountMinor" = 0 AND currency ~ '^[A-Z]{3}$'))
  AND "calculationVersion" > 0
);
CREATE FUNCTION "external_price_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."calculationVersion" = 2 AND NOT EXISTS (
    SELECT 1 FROM "Booking" b JOIN "Event" e ON e.id = b."eventId"
    WHERE b.id = NEW."bookingId" AND b.origin = 'PLATFORM' AND b.platform IS NOT NULL
    AND b."eventId" = NEW."eventId" AND e."companyId" = NEW."companyId" AND b.quantity = NEW.quantity
  ) THEN RAISE EXCEPTION 'External price requires matching external booking'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "BookingPrice_external_guard" BEFORE INSERT ON "BookingPrice" FOR EACH ROW EXECUTE FUNCTION "external_price_guard"();
COMMIT;
