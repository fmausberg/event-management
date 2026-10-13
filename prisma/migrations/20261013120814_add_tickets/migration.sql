-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'CANCELLED');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "publicTokenHash" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "checkedInAt" TIMESTAMP(3),
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_publicTokenHash_key" ON "Ticket"("publicTokenHash");

-- CreateIndex
CREATE INDEX "Ticket_bookingId_status_idx" ON "Ticket"("bookingId", "status");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
