ALTER TABLE "EventSeries" ADD COLUMN "suggestedDuration" INTEGER;

ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_suggestedDuration_positive"
CHECK ("suggestedDuration" IS NULL OR "suggestedDuration" > 0);
