-- Allow company members to be added by email before they register.
ALTER TABLE "CompanyMembership" ADD COLUMN "email" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

CREATE UNIQUE INDEX "CompanyMembership_companyId_email_key"
ON "CompanyMembership"("companyId", "email");
