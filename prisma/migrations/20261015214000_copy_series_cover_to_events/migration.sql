-- Preserve the images previously displayed through the live series fallback.
-- From now on each event owns its URL reference, independently of its series.
UPDATE "Event" AS event
SET "imageUrl" = series."imageUrl"
FROM "EventSeries" AS series
WHERE event."eventSeriesId" = series.id
  AND event."companyId" = series."companyId"
  AND event."imageUrl" IS NULL
  AND series."imageUrl" IS NOT NULL;
