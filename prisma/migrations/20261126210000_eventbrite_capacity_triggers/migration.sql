-- Keep stock work atomic with bookings, including writes from other app instances.
CREATE FUNCTION queue_eventbrite_capacity(target_event_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "EventbritePublication"
    WHERE "eventId" = target_event_id AND status = 'PUBLISHED'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO "EventbriteCapacitySync" ("eventId", "retryAt", "updatedAt")
  VALUES (target_event_id, timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP))
  ON CONFLICT ("eventId") DO UPDATE SET
    revision = "EventbriteCapacitySync".revision + 1,
    "retryAt" = timezone('UTC', CURRENT_TIMESTAMP),
    "updatedAt" = timezone('UTC', CURRENT_TIMESTAMP);
END;
$$;

CREATE FUNCTION eventbrite_capacity_booking_changed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."eventId" IS NOT DISTINCT FROM NEW."eventId"
       AND OLD.quantity IS NOT DISTINCT FROM NEW.quantity
       AND OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.platform IS NOT DISTINCT FROM NEW.platform THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF OLD.platform IS DISTINCT FROM 'EVENTBRITE' THEN
      PERFORM queue_eventbrite_capacity(OLD."eventId");
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.platform IS DISTINCT FROM 'EVENTBRITE' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM queue_eventbrite_capacity(NEW."eventId");
      ELSIF OLD.platform = 'EVENTBRITE' OR OLD."eventId" IS DISTINCT FROM NEW."eventId" THEN
        PERFORM queue_eventbrite_capacity(NEW."eventId");
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER eventbrite_capacity_booking_changed
AFTER INSERT OR UPDATE OR DELETE ON "Booking"
FOR EACH ROW EXECUTE FUNCTION eventbrite_capacity_booking_changed();

CREATE FUNCTION eventbrite_capacity_event_changed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."maxSeats" IS DISTINCT FROM NEW."maxSeats" THEN
    PERFORM queue_eventbrite_capacity(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER eventbrite_capacity_event_changed
AFTER UPDATE OF "maxSeats" ON "Event"
FOR EACH ROW EXECUTE FUNCTION eventbrite_capacity_event_changed();

CREATE FUNCTION eventbrite_capacity_publication_changed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM queue_eventbrite_capacity(NEW."eventId");
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM queue_eventbrite_capacity(NEW."eventId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER eventbrite_capacity_publication_changed
AFTER INSERT OR UPDATE OF status ON "EventbritePublication"
FOR EACH ROW EXECUTE FUNCTION eventbrite_capacity_publication_changed();

-- Repair installations where the original migration only created the table.
SELECT queue_eventbrite_capacity("eventId")
FROM "EventbritePublication" WHERE status = 'PUBLISHED';
