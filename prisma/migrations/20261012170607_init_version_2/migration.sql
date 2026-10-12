/*
  Warnings:

  - The primary key for the `Booking` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `PlatformEvent` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[number]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[number]` on the table `PlatformEvent` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `companyId` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ticketPrice` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('COMPANY_ADMIN', 'COMPANY_USER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_pkey",
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "platform" DROP NOT NULL,
ALTER COLUMN "externalBookingId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'CONFIRMED',
ALTER COLUMN "bookedAt" SET DEFAULT CURRENT_TIMESTAMP,
ADD CONSTRAINT "Booking_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "eventSeriesId" TEXT,
ADD COLUMN     "shortdescription" TEXT,
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "ticketPrice" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "trainerName" TEXT,
ADD COLUMN     "venueId" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PlatformEvent" DROP CONSTRAINT "PlatformEvent_pkey",
ADD COLUMN     "number" SERIAL NOT NULL,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'COMPANY_USER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "countryCode" CHAR(2),
    "operatorCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "shortdescription" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "suggestedMaxSeats" INTEGER,
    "suggestedTicketPrice" DECIMAL(10,2),
    "suggestedCurrency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "suggestedTrainerName" TEXT,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "suggestedVenueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_number_key" ON "User"("number");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_number_key" ON "Company"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_number_key" ON "CompanyMembership"("number");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_status_idx" ON "CompanyMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_number_key" ON "Venue"("number");

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_number_key" ON "EventSeries"("number");

-- CreateIndex
CREATE INDEX "EventSeries_companyId_name_idx" ON "EventSeries"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_number_key" ON "Booking"("number");

-- CreateIndex
CREATE INDEX "Booking_userId_bookedAt_idx" ON "Booking"("userId", "bookedAt");

-- CreateIndex
CREATE INDEX "Event_eventSeriesId_Begin_idx" ON "Event"("eventSeriesId", "Begin");

-- CreateIndex
CREATE INDEX "Event_companyId_Begin_idx" ON "Event"("companyId", "Begin");

-- CreateIndex
CREATE INDEX "Event_status_Begin_idx" ON "Event"("status", "Begin");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformEvent_number_key" ON "PlatformEvent"("number");

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_operatorCompanyId_fkey" FOREIGN KEY ("operatorCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_suggestedVenueId_fkey" FOREIGN KEY ("suggestedVenueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
