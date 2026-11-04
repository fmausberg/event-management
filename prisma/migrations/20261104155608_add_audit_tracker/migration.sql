-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS', 'UNKNOWN');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "operation" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" TEXT,
    "source" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "changedFields" TEXT[],
    "redactedFields" TEXT[],
    "before" JSONB,
    "after" JSONB,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_companyId_model_recordId_occurredAt_id_idx" ON "AuditLog"("companyId", "model", "recordId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_occurredAt_id_idx" ON "AuditLog"("actorUserId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_id_idx" ON "AuditLog"("occurredAt", "id");
