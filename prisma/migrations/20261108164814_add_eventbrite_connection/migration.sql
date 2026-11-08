-- CreateEnum
CREATE TYPE "EventbriteConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "EventbriteConnection" (
    "companyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "status" "EventbriteConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventbriteConnection_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "EventbriteOAuth" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "stateHash" TEXT,
    "encryptedAccessToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventbriteOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventbriteConnection_organizationId_key" ON "EventbriteConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventbriteOAuth_companyId_key" ON "EventbriteOAuth"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EventbriteOAuth_stateHash_key" ON "EventbriteOAuth"("stateHash");

-- CreateIndex
CREATE INDEX "EventbriteOAuth_expiresAt_idx" ON "EventbriteOAuth"("expiresAt");

-- AddForeignKey
ALTER TABLE "EventbriteConnection" ADD CONSTRAINT "EventbriteConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventbriteOAuth" ADD CONSTRAINT "EventbriteOAuth_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
