-- Existing descriptions are always plaintext. Prisma records this migration once.
BEGIN;
CREATE FUNCTION pg_temp.description_plaintext_to_html(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE WHEN value = '' THEN '' ELSE
    '<p>' || replace(regexp_replace(
      replace(replace(replace(replace(replace(replace(replace(value,
        '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;'),
        E'\r\n', E'\n'), E'\r', E'\n'),
      E'\n[ \t]*\n', '</p><p>', 'g'), E'\n', '<br>') || '</p>' END;
$$;
UPDATE "Event" SET "description" = pg_temp.description_plaintext_to_html("description") WHERE "description" IS NOT NULL AND "description" <> '';
UPDATE "EventSeries" SET "description" = pg_temp.description_plaintext_to_html("description") WHERE "description" IS NOT NULL AND "description" <> '';
DROP FUNCTION pg_temp.description_plaintext_to_html(TEXT);
COMMIT;
