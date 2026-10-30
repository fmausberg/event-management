-- Preserve all existing events. Reminder state starts unsent for every event.
CREATE TYPE "MailOutboxKind" AS ENUM ('TRAINER_REMINDER');

ALTER TABLE "Event" ADD COLUMN "trainerReminderSentAt" TIMESTAMP(3);

CREATE TABLE "TrainerReminder" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "manualRequestedAt" TIMESTAMP(3),
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerReminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MailOutbox" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" "MailOutboxKind" NOT NULL,
    "trainerReminderId" TEXT,
    "trainerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainerReminder_requestKey_key" ON "TrainerReminder"("requestKey");
CREATE UNIQUE INDEX "TrainerReminder_eventId_key" ON "TrainerReminder"("eventId");
CREATE INDEX "TrainerReminder_createdAt_idx" ON "TrainerReminder"("createdAt");
CREATE UNIQUE INDEX "MailOutbox_requestKey_key" ON "MailOutbox"("requestKey");
CREATE UNIQUE INDEX "MailOutbox_kind_trainerReminderId_trainerId_key" ON "MailOutbox"("kind", "trainerReminderId", "trainerId");
CREATE INDEX "MailOutbox_sentAt_cancelledAt_availableAt_createdAt_idx" ON "MailOutbox"("sentAt", "cancelledAt", "availableAt", "createdAt");
CREATE INDEX "MailOutbox_trainerReminderId_createdAt_idx" ON "MailOutbox"("trainerReminderId", "createdAt");
CREATE INDEX "MailOutbox_trainerId_idx" ON "MailOutbox"("trainerId");

ALTER TABLE "TrainerReminder" ADD CONSTRAINT "TrainerReminder_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailOutbox" ADD CONSTRAINT "MailOutbox_trainerReminderId_fkey"
  FOREIGN KEY ("trainerReminderId") REFERENCES "TrainerReminder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailOutbox" ADD CONSTRAINT "MailOutbox_trainerId_fkey"
  FOREIGN KEY ("trainerId") REFERENCES "Trainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
