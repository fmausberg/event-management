-- Keep previous reminders while allowing separate manual requests for one event.
DROP INDEX IF EXISTS "TrainerReminder_eventId_key";
CREATE INDEX IF NOT EXISTS "TrainerReminder_eventId_createdAt_idx"
  ON "TrainerReminder"("eventId", "createdAt");