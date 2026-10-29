-- CreateEnum
CREATE TYPE "VoucherKind" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'STORED_VALUE');

-- CreateEnum
CREATE TYPE "VoucherCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VoucherCodeMode" AS ENUM ('PUBLIC', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "VoucherCodeStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VoucherRedemptionStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VoucherBalanceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VoucherBalanceUseStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'PARTIALLY_REVERSED', 'REVERSED');

-- CreateEnum
CREATE TYPE "VoucherBalanceEntryType" AS ENUM ('ISSUE', 'RESERVE', 'RELEASE', 'SPEND', 'RESTORE', 'ADJUST');

-- CreateTable
CREATE TABLE "VoucherCampaign" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "status" "VoucherCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "percentageBps" INTEGER,
    "amountMinor" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "maxRedemptionsPerCustomer" INTEGER,
    "maxEligibleTicketsPerBooking" INTEGER,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "policy" JSONB,
    "source" TEXT,
    "ownerCompanyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherCampaignCompany" (
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "VoucherCampaignCompany_pkey" PRIMARY KEY ("campaignId","companyId")
);

-- CreateTable
CREATE TABLE "VoucherCampaignEventSeries" (
    "campaignId" TEXT NOT NULL,
    "eventSeriesId" TEXT NOT NULL,

    CONSTRAINT "VoucherCampaignEventSeries_pkey" PRIMARY KEY ("campaignId","eventSeriesId")
);

-- CreateTable
CREATE TABLE "VoucherCampaignEvent" (
    "campaignId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "VoucherCampaignEvent_pkey" PRIMARY KEY ("campaignId","eventId")
);

-- CreateTable
CREATE TABLE "VoucherCampaignVenue" (
    "campaignId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,

    CONSTRAINT "VoucherCampaignVenue_pkey" PRIMARY KEY ("campaignId","venueId")
);

-- CreateTable
CREATE TABLE "VoucherCode" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "codeDigest" VARCHAR(128) NOT NULL,
    "digestVersion" INTEGER NOT NULL,
    "codeSuffix" VARCHAR(4),
    "mode" "VoucherCodeMode" NOT NULL,
    "status" "VoucherCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxRedemptions" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "assignedUserId" TEXT,
    "source" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "userId" TEXT,
    "requestKey" TEXT NOT NULL,
    "status" "VoucherRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedUntil" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "limitReturnedAt" TIMESTAMP(3),
    "eligibleQuantity" INTEGER NOT NULL,
    "eligibleAmountMinor" INTEGER NOT NULL,
    "discountAmountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "targetSnapshot" JSONB NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherBalance" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "issuerCompanyId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initialAmountMinor" INTEGER NOT NULL,
    "balanceMinor" INTEGER NOT NULL DEFAULT 0,
    "reservedMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "VoucherBalanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "issuanceSource" TEXT NOT NULL,
    "issuanceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherBalanceUse" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "userId" TEXT,
    "requestKey" TEXT NOT NULL,
    "status" "VoucherBalanceUseStatus" NOT NULL DEFAULT 'RESERVED',
    "amountMinor" INTEGER NOT NULL,
    "restoredMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "reservedUntil" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "ruleVersion" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "targetSnapshot" JSONB NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherBalanceUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherBalanceEntry" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "useId" TEXT,
    "type" "VoucherBalanceEntryType" NOT NULL,
    "operationKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "balanceDeltaMinor" INTEGER NOT NULL,
    "reservedDeltaMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reversalOfId" TEXT,
    "cancellationRequestId" TEXT,
    "externalRefundId" TEXT,
    "createdById" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherBalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPrice" (
    "bookingId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "originalAmountMinor" INTEGER NOT NULL,
    "discountAmountMinor" INTEGER NOT NULL,
    "voucherAmountMinor" INTEGER NOT NULL,
    "payableAmountMinor" INTEGER NOT NULL,
    "calculationVersion" INTEGER NOT NULL,
    "allocationSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPrice_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoucherCampaign_number_key" ON "VoucherCampaign"("number");

-- CreateIndex
CREATE INDEX "VoucherCampaign_ownerCompanyId_status_idx" ON "VoucherCampaign"("ownerCompanyId", "status");

-- CreateIndex
CREATE INDEX "VoucherCampaign_createdById_idx" ON "VoucherCampaign"("createdById");

-- CreateIndex
CREATE INDEX "VoucherCampaignCompany_companyId_idx" ON "VoucherCampaignCompany"("companyId");

-- CreateIndex
CREATE INDEX "VoucherCampaignEventSeries_eventSeriesId_idx" ON "VoucherCampaignEventSeries"("eventSeriesId");

-- CreateIndex
CREATE INDEX "VoucherCampaignEvent_eventId_idx" ON "VoucherCampaignEvent"("eventId");

-- CreateIndex
CREATE INDEX "VoucherCampaignVenue_venueId_idx" ON "VoucherCampaignVenue"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherCode_codeDigest_key" ON "VoucherCode"("codeDigest");

-- CreateIndex
CREATE INDEX "VoucherCode_campaignId_status_idx" ON "VoucherCode"("campaignId", "status");

-- CreateIndex
CREATE INDEX "VoucherCode_assignedUserId_idx" ON "VoucherCode"("assignedUserId");

-- CreateIndex
CREATE INDEX "VoucherCode_campaignId_batchId_idx" ON "VoucherCode"("campaignId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherCode_id_campaignId_key" ON "VoucherCode"("id", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_bookingId_key" ON "VoucherRedemption"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_requestKey_key" ON "VoucherRedemption"("requestKey");

-- CreateIndex
CREATE INDEX "VoucherRedemption_campaignId_status_limitReturnedAt_idx" ON "VoucherRedemption"("campaignId", "status", "limitReturnedAt");

-- CreateIndex
CREATE INDEX "VoucherRedemption_codeId_status_limitReturnedAt_idx" ON "VoucherRedemption"("codeId", "status", "limitReturnedAt");

-- CreateIndex
CREATE INDEX "VoucherRedemption_campaignId_userId_status_idx" ON "VoucherRedemption"("campaignId", "userId", "status");

-- CreateIndex
CREATE INDEX "VoucherRedemption_userId_idx" ON "VoucherRedemption"("userId");

-- CreateIndex
CREATE INDEX "VoucherRedemption_status_reservedUntil_idx" ON "VoucherRedemption"("status", "reservedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalance_codeId_key" ON "VoucherBalance"("codeId");

-- CreateIndex
CREATE INDEX "VoucherBalance_issuerCompanyId_status_idx" ON "VoucherBalance"("issuerCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalance_id_codeId_key" ON "VoucherBalance"("id", "codeId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalanceUse_requestKey_key" ON "VoucherBalanceUse"("requestKey");

-- CreateIndex
CREATE INDEX "VoucherBalanceUse_balanceId_status_idx" ON "VoucherBalanceUse"("balanceId", "status");

-- CreateIndex
CREATE INDEX "VoucherBalanceUse_codeId_campaignId_idx" ON "VoucherBalanceUse"("codeId", "campaignId");

-- CreateIndex
CREATE INDEX "VoucherBalanceUse_campaignId_userId_status_idx" ON "VoucherBalanceUse"("campaignId", "userId", "status");

-- CreateIndex
CREATE INDEX "VoucherBalanceUse_userId_idx" ON "VoucherBalanceUse"("userId");

-- CreateIndex
CREATE INDEX "VoucherBalanceUse_status_reservedUntil_idx" ON "VoucherBalanceUse"("status", "reservedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalanceUse_bookingId_balanceId_key" ON "VoucherBalanceUse"("bookingId", "balanceId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalanceUse_id_balanceId_key" ON "VoucherBalanceUse"("id", "balanceId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalanceEntry_operationKey_key" ON "VoucherBalanceEntry"("operationKey");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_balanceId_createdAt_id_idx" ON "VoucherBalanceEntry"("balanceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_useId_balanceId_idx" ON "VoucherBalanceEntry"("useId", "balanceId");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_reversalOfId_balanceId_idx" ON "VoucherBalanceEntry"("reversalOfId", "balanceId");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_cancellationRequestId_idx" ON "VoucherBalanceEntry"("cancellationRequestId");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_externalRefundId_idx" ON "VoucherBalanceEntry"("externalRefundId");

-- CreateIndex
CREATE INDEX "VoucherBalanceEntry_createdById_idx" ON "VoucherBalanceEntry"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherBalanceEntry_id_balanceId_key" ON "VoucherBalanceEntry"("id", "balanceId");

-- CreateIndex
CREATE INDEX "BookingPrice_eventId_idx" ON "BookingPrice"("eventId");

-- CreateIndex
CREATE INDEX "BookingPrice_companyId_idx" ON "BookingPrice"("companyId");

-- AddForeignKey
ALTER TABLE "VoucherCampaign" ADD CONSTRAINT "VoucherCampaign_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaign" ADD CONSTRAINT "VoucherCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignCompany" ADD CONSTRAINT "VoucherCampaignCompany_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignCompany" ADD CONSTRAINT "VoucherCampaignCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignEventSeries" ADD CONSTRAINT "VoucherCampaignEventSeries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignEventSeries" ADD CONSTRAINT "VoucherCampaignEventSeries_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignEvent" ADD CONSTRAINT "VoucherCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignEvent" ADD CONSTRAINT "VoucherCampaignEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignVenue" ADD CONSTRAINT "VoucherCampaignVenue_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCampaignVenue" ADD CONSTRAINT "VoucherCampaignVenue_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_codeId_campaignId_fkey" FOREIGN KEY ("codeId", "campaignId") REFERENCES "VoucherCode"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalance" ADD CONSTRAINT "VoucherBalance_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "VoucherCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalance" ADD CONSTRAINT "VoucherBalance_issuerCompanyId_fkey" FOREIGN KEY ("issuerCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceUse" ADD CONSTRAINT "VoucherBalanceUse_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceUse" ADD CONSTRAINT "VoucherBalanceUse_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoucherCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceUse" ADD CONSTRAINT "VoucherBalanceUse_codeId_campaignId_fkey" FOREIGN KEY ("codeId", "campaignId") REFERENCES "VoucherCode"("id", "campaignId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceUse" ADD CONSTRAINT "VoucherBalanceUse_balanceId_codeId_fkey" FOREIGN KEY ("balanceId", "codeId") REFERENCES "VoucherBalance"("id", "codeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceUse" ADD CONSTRAINT "VoucherBalanceUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBalanceEntry" ADD CONSTRAINT "VoucherBalanceEntry_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "VoucherBalance"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VoucherBalanceEntry" ADD CONSTRAINT "VoucherBalanceEntry_useId_balanceId_fkey" FOREIGN KEY ("useId", "balanceId") REFERENCES "VoucherBalanceUse"("id", "balanceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VoucherBalanceEntry" ADD CONSTRAINT "VoucherBalanceEntry_reversalOfId_balanceId_fkey" FOREIGN KEY ("reversalOfId", "balanceId") REFERENCES "VoucherBalanceEntry"("id", "balanceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VoucherBalanceEntry" ADD CONSTRAINT "VoucherBalanceEntry_cancellationRequestId_fkey" FOREIGN KEY ("cancellationRequestId") REFERENCES "CancellationRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VoucherBalanceEntry" ADD CONSTRAINT "VoucherBalanceEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BookingPrice" ADD CONSTRAINT "BookingPrice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BookingPrice" ADD CONSTRAINT "BookingPrice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BookingPrice" ADD CONSTRAINT "BookingPrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL-only invariants: preserve these CHECKs, partial indexes and triggers in
-- subsequent migrations. No existing table rows are changed or backfilled.
ALTER TABLE "VoucherCampaign"
  ADD CONSTRAINT "VoucherCampaign_value_check" CHECK (
    ("kind" = 'PERCENTAGE' AND "percentageBps" IS NOT NULL AND "percentageBps" BETWEEN 1 AND 10000 AND "amountMinor" IS NULL)
    OR ("kind" IN ('FIXED_AMOUNT', 'STORED_VALUE') AND "percentageBps" IS NULL AND "amountMinor" IS NOT NULL AND "amountMinor" > 0)
  ),
  ADD CONSTRAINT "VoucherCampaign_currency_check" CHECK ("currency" = 'EUR'),
  ADD CONSTRAINT "VoucherCampaign_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "VoucherCampaign_limits_check" CHECK (
    ("maxRedemptions" IS NULL OR "maxRedemptions" > 0)
    AND ("maxRedemptionsPerCustomer" IS NULL OR "maxRedemptionsPerCustomer" > 0)
    AND ("maxEligibleTicketsPerBooking" IS NULL OR "maxEligibleTicketsPerBooking" > 0)
    AND "ruleVersion" > 0
  );

ALTER TABLE "VoucherCode"
  ADD CONSTRAINT "VoucherCode_digest_check" CHECK (length(btrim("codeDigest")) > 0 AND "digestVersion" > 0),
  ADD CONSTRAINT "VoucherCode_limit_check" CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0),
  ADD CONSTRAINT "VoucherCode_period_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "VoucherRedemption"
  ADD CONSTRAINT "VoucherRedemption_amount_check" CHECK (
    "eligibleQuantity" > 0 AND "eligibleAmountMinor" > 0
    AND "discountAmountMinor" > 0 AND "discountAmountMinor" <= "eligibleAmountMinor"
    AND "currency" = 'EUR' AND "ruleVersion" > 0
  ),
  ADD CONSTRAINT "VoucherRedemption_reservation_check" CHECK ("status" <> 'RESERVED' OR "reservedUntil" IS NOT NULL),
  ADD CONSTRAINT "VoucherRedemption_limit_return_check" CHECK ("limitReturnedAt" IS NULL OR "status" = 'REVERSED'),
  ADD CONSTRAINT "VoucherRedemption_request_key_check" CHECK (length(btrim("requestKey")) > 0);

ALTER TABLE "VoucherBalance"
  ADD CONSTRAINT "VoucherBalance_amount_check" CHECK (
    "initialAmountMinor" > 0 AND "balanceMinor" >= 0 AND "reservedMinor" >= 0
    AND "reservedMinor" <= "balanceMinor" AND "currency" = 'EUR'
  ),
  ADD CONSTRAINT "VoucherBalance_source_check" CHECK (length(btrim("issuanceSource")) > 0);

ALTER TABLE "VoucherBalanceUse"
  ADD CONSTRAINT "VoucherBalanceUse_amount_check" CHECK (
    "amountMinor" > 0 AND "restoredMinor" >= 0 AND "restoredMinor" <= "amountMinor"
    AND "currency" = 'EUR' AND "ruleVersion" > 0
  ),
  ADD CONSTRAINT "VoucherBalanceUse_restoration_check" CHECK (
    ("status" IN ('RESERVED', 'COMMITTED', 'RELEASED') AND "restoredMinor" = 0)
    OR ("status" = 'PARTIALLY_REVERSED' AND "restoredMinor" > 0 AND "restoredMinor" < "amountMinor")
    OR ("status" = 'REVERSED' AND "restoredMinor" = "amountMinor")
  ),
  ADD CONSTRAINT "VoucherBalanceUse_reservation_check" CHECK ("status" <> 'RESERVED' OR "reservedUntil" IS NOT NULL),
  ADD CONSTRAINT "VoucherBalanceUse_request_key_check" CHECK (length(btrim("requestKey")) > 0);

ALTER TABLE "VoucherBalanceEntry"
  ADD CONSTRAINT "VoucherBalanceEntry_amount_check" CHECK ("amountMinor" > 0 AND "currency" = 'EUR'),
  ADD CONSTRAINT "VoucherBalanceEntry_operation_check" CHECK (length(btrim("operationKey")) > 0 AND length(btrim("reason")) > 0),
  ADD CONSTRAINT "VoucherBalanceEntry_reversal_check" CHECK (
    ("reversalOfId" IS NULL OR "reversalOfId" <> "id")
    AND ("type" <> 'RESTORE' OR "reversalOfId" IS NOT NULL)
    AND ("type" IN ('RESTORE', 'ADJUST') OR "reversalOfId" IS NULL)
  ),
  ADD CONSTRAINT "VoucherBalanceEntry_deltas_check" CHECK (
    ("type" = 'ISSUE' AND "useId" IS NULL AND "balanceDeltaMinor" = "amountMinor" AND "reservedDeltaMinor" = 0)
    OR ("type" = 'RESERVE' AND "useId" IS NOT NULL AND "balanceDeltaMinor" = 0 AND "reservedDeltaMinor" = "amountMinor")
    OR ("type" = 'RELEASE' AND "useId" IS NOT NULL AND "balanceDeltaMinor" = 0 AND "reservedDeltaMinor" = -"amountMinor")
    OR ("type" = 'SPEND' AND "useId" IS NOT NULL AND "balanceDeltaMinor" = -"amountMinor" AND "reservedDeltaMinor" = -"amountMinor")
    OR ("type" = 'RESTORE' AND "useId" IS NOT NULL AND "balanceDeltaMinor" = "amountMinor" AND "reservedDeltaMinor" = 0)
    OR ("type" = 'ADJUST' AND "createdById" IS NOT NULL AND abs("balanceDeltaMinor"::bigint) = "amountMinor" AND "reservedDeltaMinor" = 0)
  );

-- A different request key cannot issue twice or both spend and release the same hold.
CREATE UNIQUE INDEX "VoucherBalanceEntry_one_issue_per_balance"
  ON "VoucherBalanceEntry" ("balanceId") WHERE "type" = 'ISSUE';
CREATE UNIQUE INDEX "VoucherBalanceEntry_one_reservation_per_use"
  ON "VoucherBalanceEntry" ("useId") WHERE "type" = 'RESERVE';
CREATE UNIQUE INDEX "VoucherBalanceEntry_one_resolution_per_use"
  ON "VoucherBalanceEntry" ("useId") WHERE "type" IN ('SPEND', 'RELEASE');

ALTER TABLE "BookingPrice"
  ADD CONSTRAINT "BookingPrice_amount_check" CHECK (
    "unitPriceMinor" >= 0 AND "quantity" > 0 AND "originalAmountMinor" >= 0
    AND "discountAmountMinor" >= 0 AND "voucherAmountMinor" >= 0 AND "payableAmountMinor" >= 0
    AND "originalAmountMinor"::bigint = "unitPriceMinor"::bigint * "quantity"::bigint
    AND "originalAmountMinor"::bigint = "discountAmountMinor"::bigint + "voucherAmountMinor"::bigint + "payableAmountMinor"::bigint
    AND "currency" = 'EUR' AND "calculationVersion" > 0
  );

-- Financial history is append-only. This does not implement balance settlement:
-- future writers must atomically update projections and insert journal records.
CREATE FUNCTION "reject_voucher_history_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Voucher history in % is append-only; insert a compensating entry instead', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "VoucherBalanceEntry_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "VoucherBalanceEntry"
  FOR EACH ROW EXECUTE FUNCTION "reject_voucher_history_mutation"();
CREATE TRIGGER "VoucherBalanceEntry_no_truncate"
  BEFORE TRUNCATE ON "VoucherBalanceEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_voucher_history_mutation"();
CREATE TRIGGER "BookingPrice_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "BookingPrice"
  FOR EACH ROW EXECUTE FUNCTION "reject_voucher_history_mutation"();
CREATE TRIGGER "BookingPrice_no_truncate"
  BEFORE TRUNCATE ON "BookingPrice"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_voucher_history_mutation"();
