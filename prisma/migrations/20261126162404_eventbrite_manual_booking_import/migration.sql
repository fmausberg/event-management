-- AlterTable
ALTER TABLE "PlatformEvent" ADD COLUMN     "bookingImportStartedAt" TIMESTAMP(3),
ADD COLUMN     "bookingImportToken" TEXT,
ADD COLUMN     "lastBookingImportAt" TIMESTAMP(3),
ADD COLUMN     "lastBookingImportError" TEXT;
