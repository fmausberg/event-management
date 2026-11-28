-- AlterEnum
ALTER TYPE "TaxRuleSource" ADD VALUE 'COMPANY_SMALL_BUSINESS';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "countryCode" CHAR(2),
ADD COLUMN     "isSmallBusiness" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "taxNumber" TEXT,
ADD COLUMN     "vatId" TEXT;
