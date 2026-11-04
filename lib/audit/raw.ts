import "server-only";

// Exact, reviewed SQL shapes already used by the application. Never infer safety
// from a SELECT prefix: SELECT can call mutating PostgreSQL functions.
const reviewCandidates = `
SELECT candidate.id FROM (
SELECT DISTINCT ON (b."eventId", lower(trim(coalesce(b."customerEmail", u.email)))) b.id
FROM "Booking" b JOIN "Event" e ON e.id = b."eventId"
LEFT JOIN "User" u ON u.id = b."userId"
WHERE e."End" <= ? AND e.status IN ('PUBLISHED', 'COMPLETED')
AND coalesce(b."customerEmail", u.email) IS NOT NULL
AND trim(coalesce(b."customerEmail", u.email)) <> ''
AND EXISTS (SELECT 1 FROM "Ticket" t WHERE t."bookingId" = b.id AND t."checkedInAt" IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM "EventReview" r WHERE r."eventId" = b."eventId"
AND r."recipientEmail" = lower(trim(coalesce(b."customerEmail", u.email))))
ORDER BY b."eventId", lower(trim(coalesce(b."customerEmail", u.email))), b.id
) candidate WHERE candidate.id > ? ORDER BY candidate.id LIMIT 50`;
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
const allowed = new Set([
  "SELECT 1",
  'SELECT "id" FROM "Booking" WHERE "id" = ? FOR UPDATE',
  'SELECT "id" FROM "VoucherCampaign" WHERE "id" = ? FOR UPDATE',
  'SELECT "id" FROM "VoucherBalance" WHERE "id" = ? FOR UPDATE',
  "SELECT pg_advisory_xact_lock(190721, 1)",
  reviewCandidates,
].map(normalize));

export function assertReviewedRaw(method: string, input: unknown) {
  if (method.endsWith("Unsafe")) throw new Error("Audit: unsafe Raw-SQL ist am zentralen Prisma-Zugang nicht erlaubt.");
  const strings = Array.isArray(input) ? input : input && typeof input === "object" && "strings" in input ? input.strings : null;
  if (!Array.isArray(strings) || !strings.every((part) => typeof part === "string") || !allowed.has(normalize(strings.join("?")))) {
    throw new Error("Audit: Raw-SQL ist nicht freigegeben. Verwende Prisma-Modelloperationen oder ergänze eine geprüfte SQL-Freigabe.");
  }
}
