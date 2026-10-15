-- AlterTable
ALTER TABLE "EventSeries" ADD COLUMN     "suggestedTrainerId" TEXT;

-- CreateTable
CREATE TABLE "Trainer" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTrainer" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTrainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trainer_number_key" ON "Trainer"("number");

-- CreateIndex
CREATE INDEX "Trainer_userId_idx" ON "Trainer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Trainer_companyId_email_key" ON "Trainer"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EventTrainer_number_key" ON "EventTrainer"("number");

-- CreateIndex
CREATE INDEX "EventTrainer_trainerId_idx" ON "EventTrainer"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTrainer_eventId_trainerId_key" ON "EventTrainer"("eventId", "trainerId");

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_suggestedTrainerId_fkey" FOREIGN KEY ("suggestedTrainerId") REFERENCES "Trainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trainer" ADD CONSTRAINT "Trainer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trainer" ADD CONSTRAINT "Trainer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrainer" ADD CONSTRAINT "EventTrainer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTrainer" ADD CONSTRAINT "EventTrainer_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "Trainer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
