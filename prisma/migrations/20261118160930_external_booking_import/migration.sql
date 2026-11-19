-- DropForeignKey
ALTER TABLE "BookingImport" DROP CONSTRAINT "BookingImport_companyId_fkey";

-- DropForeignKey
ALTER TABLE "BookingImport" DROP CONSTRAINT "BookingImport_createdById_fkey";

-- DropForeignKey
ALTER TABLE "BookingImportRow" DROP CONSTRAINT "BookingImportRow_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "BookingImportRow" DROP CONSTRAINT "BookingImportRow_eventId_fkey";

-- DropForeignKey
ALTER TABLE "BookingImportRow" DROP CONSTRAINT "BookingImportRow_importId_fkey";

-- AddForeignKey
ALTER TABLE "BookingImport" ADD CONSTRAINT "BookingImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingImport" ADD CONSTRAINT "BookingImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingImportRow" ADD CONSTRAINT "BookingImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BookingImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingImportRow" ADD CONSTRAINT "BookingImportRow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingImportRow" ADD CONSTRAINT "BookingImportRow_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
