-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('EVENTBRITE', 'RAUSGEGANGEN', 'EVERSPORTS', 'URBAN_SPORTS_CLUB', 'WELLPASS', 'MYCLUBS', 'EVENTIM');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "PlatformEvent" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalBookingId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformEvent_eventId_syncStatus_idx" ON "PlatformEvent"("eventId", "syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformEvent_platform_externalEventId_key" ON "PlatformEvent"("platform", "externalEventId");

-- CreateIndex
CREATE INDEX "Booking_eventId_status_idx" ON "Booking"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_platform_externalBookingId_key" ON "Booking"("platform", "externalBookingId");

-- AddForeignKey
ALTER TABLE "PlatformEvent" ADD CONSTRAINT "PlatformEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
