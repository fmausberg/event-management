-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "Begin" TIMESTAMP(3) NOT NULL,
    "End" TIMESTAMP(3) NOT NULL,
    "maxSeats" INTEGER NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_number_key" ON "Event"("number");
