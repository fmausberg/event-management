CREATE TYPE "TaxRuleSource" AS ENUM ('EVENT_OVERRIDE', 'SERIES_OVERRIDE', 'COMPANY_COUNTRY_RULE');
CREATE TABLE "CompanyTaxRule" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "countryCode" CHAR(2) NOT NULL, "rate" DECIMAL(7,4) NOT NULL CHECK ("rate" BETWEEN 0 AND 100),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CompanyTaxRule_country_valid" CHECK ("countryCode" IN ('AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'))
);
CREATE UNIQUE INDEX "CompanyTaxRule_companyId_countryCode_key" ON "CompanyTaxRule"("companyId", "countryCode");
ALTER TABLE "EventSeries" ADD COLUMN "taxRateOverride" DECIMAL(7,4) CHECK ("taxRateOverride" BETWEEN 0 AND 100);
ALTER TABLE "Event" ADD COLUMN "taxRateOverride" DECIMAL(7,4) CHECK ("taxRateOverride" BETWEEN 0 AND 100);
ALTER TABLE "BookingPrice"
 ADD COLUMN "taxCountryCode" CHAR(2), ADD COLUMN "taxRate" DECIMAL(7,4),
 ADD COLUMN "taxGrossMinor" INTEGER, ADD COLUMN "taxMinor" INTEGER, ADD COLUMN "taxNetMinor" INTEGER,
 ADD COLUMN "taxSource" "TaxRuleSource", ADD COLUMN "taxCalculationVersion" INTEGER,
 ADD CONSTRAINT "BookingPrice_tax_consistent" CHECK (
  ("taxCalculationVersion" IS NULL AND "taxCountryCode" IS NULL AND "taxRate" IS NULL AND "taxGrossMinor" IS NULL AND "taxMinor" IS NULL AND "taxNetMinor" IS NULL AND "taxSource" IS NULL)
  OR ("taxCalculationVersion" IS NOT NULL AND "taxCalculationVersion" = 1 AND "taxCountryCode" IS NOT NULL AND "taxRate" IS NOT NULL AND "taxRate" BETWEEN 0 AND 100 AND "taxGrossMinor" IS NOT NULL AND "taxMinor" IS NOT NULL AND "taxNetMinor" IS NOT NULL AND "taxSource" IS NOT NULL AND "taxGrossMinor" >= 0 AND "taxMinor" >= 0 AND "taxNetMinor" >= 0 AND "taxGrossMinor" = "taxMinor" + "taxNetMinor" AND "taxGrossMinor" = "payableAmountMinor" AND "taxMinor" = ROUND("taxGrossMinor"::numeric * "taxRate" / (100 + "taxRate")))
 );
-- Existing BookingPrice append-only trigger also protects the new columns. No backfill.

CREATE TABLE "StripeTaxRateCache" (
 "stripeAccountId" TEXT NOT NULL, "countryCode" CHAR(2) NOT NULL, "rate" DECIMAL(7,4) NOT NULL,
 "displayName" TEXT NOT NULL, "stripeTaxRateId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("stripeAccountId", "countryCode", "rate", "displayName")
);
