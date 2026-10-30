-- Keep previous reminders while allowing separate manual requests for one event.
DROP INDEX "TrainerReminder_eventId_key";
CREATE INDEX "TrainerReminder_eventId_createdAt_idx" ON "TrainerReminder"("eventId", "createdAt");
