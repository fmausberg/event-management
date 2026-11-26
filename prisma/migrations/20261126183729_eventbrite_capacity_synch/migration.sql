-- CreateTable
CREATE TABLE "EventbriteCapacitySync" (
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "syncedRevision" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "lastCapacity" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventbriteCapacitySync_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "EventbriteCapacitySync_retryAt_idx" ON "EventbriteCapacitySync"("retryAt");

-- AddForeignKey
ALTER TABLE "EventbriteCapacitySync" ADD CONSTRAINT "EventbriteCapacitySync_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
