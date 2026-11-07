-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('COMPANY', 'PRIVATE');

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'COMPANY',
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT,
    "eventSeriesId" TEXT,
    "venueId" TEXT,
    "bookingId" TEXT,
    "ticketId" TEXT,
    "trainerId" TEXT,
    "cancellationRequestId" TEXT,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Note_number_key" ON "Note"("number");

-- CreateIndex
CREATE INDEX "Note_authorId_idx" ON "Note"("authorId");

-- CreateIndex
CREATE INDEX "Note_eventId_createdAt_id_idx" ON "Note"("eventId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_eventSeriesId_createdAt_id_idx" ON "Note"("eventSeriesId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_venueId_createdAt_id_idx" ON "Note"("venueId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_bookingId_createdAt_id_idx" ON "Note"("bookingId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_ticketId_createdAt_id_idx" ON "Note"("ticketId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_trainerId_createdAt_id_idx" ON "Note"("trainerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Note_cancellationRequestId_createdAt_id_idx" ON "Note"("cancellationRequestId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Trainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_cancellationRequestId_fkey" FOREIGN KEY ("cancellationRequestId") REFERENCES "CancellationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
