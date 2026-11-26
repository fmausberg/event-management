-- Preserve the publication state of events predating trainer confirmation.
-- Only pending assignments on already public or historical events are backfilled.
UPDATE "EventTrainer" et
SET "responseStatus" = 'ACCEPTED'
FROM "Event" e
WHERE e.id = et."eventId"
  AND e.status IN ('PUBLISHED', 'COMPLETED', 'CANCELLED')
  AND et."responseStatus" = 'PENDING';
