import "server-only";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { Prisma } from "@prisma/client";
import { emptyAuditFilters, parseAuditFilters, type AuditFilters } from "./filters";
import { parseBerlinDateTime } from "@/lib/events/berlin-date-time";
import { RECOVERY_ADMIN_ID } from "@/lib/auth/recovery-admin";

function identityFromSnapshot(before: Prisma.JsonValue, after: Prisma.JsonValue) {
  const old = before && typeof before === "object" && !Array.isArray(before) ? before : {};
  const next = after && typeof after === "object" && !Array.isArray(after) ? after : {};
  const name = next.name ?? old.name;
  const number = next.number ?? old.number;
  return { name: typeof name === "string" ? name : null, number: typeof number === "number" ? number : null };
}

async function loadHistory(where: Prisma.AuditLogWhereInput, page: number) {
  const db = getPrisma();
  const currentPage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000000) : 1;
  const rows = await db.auditLog.findMany({
    where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (currentPage - 1) * 20, take: 21,
  });
  const entries = rows.slice(0, 20);
  const actorIds = [...new Set(entries.filter((row) => row.actorType === "USER" && row.actorUserId).map((row) => row.actorUserId!))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
  const emails = new Map(actors.map((actor) => [actor.id, actor.email]));
  // Legacy entries did not persist identity metadata. Resolve their live series
  // when available; never invent historical names for deleted objects.
  const legacyIds = entries.filter((entry) => entry.model === "EventSeries" && (!entry.recordName || entry.recordNumber === null) && (!identityFromSnapshot(entry.before, entry.after).name || identityFromSnapshot(entry.before, entry.after).number === null)).map((entry) => entry.recordId);
  const series = legacyIds.length ? await db.eventSeries.findMany({ where: { id: { in: legacyIds } }, select: { id: true, name: true, number: true } }) : [];
  const legacy = new Map(series.map((row) => [row.id, row]));
  return { entries: entries.map((entry) => ({
    ...entry,
    actorEmail: entry.actorUserId === RECOVERY_ADMIN_ID ? "admin (Recovery)" : entry.actorUserId ? emails.get(entry.actorUserId) ?? null : null,
    recordNumber: entry.recordNumber ?? identityFromSnapshot(entry.before, entry.after).number ?? (entry.model === "EventSeries" ? legacy.get(entry.recordId)?.number : null) ?? null,
    recordName: entry.recordName ?? identityFromSnapshot(entry.before, entry.after).name ?? (entry.model === "EventSeries" ? legacy.get(entry.recordId)?.name : null) ?? null,
  })), hasNext: rows.length > 20, page: currentPage };
}

export async function getAdminAuditHistory(page = 1, input: AuditFilters = emptyAuditFilters) {
  await requireAdmin();
  const filters = parseAuditFilters({ actor: input.actors, action: input.actions, model: input.models, from: input.from, to: input.to });
  const actors: Prisma.AuditLogWhereInput[] = filters.actors.map(value => value.startsWith("user:")
    ? { actorType: "USER", actorUserId: value.slice(5) }
    : { actorType: value.slice(5) as "USER" | "SYSTEM" | "ANONYMOUS" | "UNKNOWN" });
  return loadHistory({
    ...(actors.length ? { OR: actors } : {}),
    ...(filters.actions.length ? { action: { in: filters.actions } } : {}),
    ...(filters.models.length ? { model: { in: filters.models } } : {}),
    ...(filters.from || filters.to ? { occurredAt: {
      ...(filters.from ? { gte: parseBerlinDateTime(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(parseBerlinDateTime(filters.to).getTime() + 59999) } : {}),
    } } : {}),
  }, page);
}

export async function getAdminAuditActors() {
  await requireAdmin();
  const db = getPrisma();
  const actors = await db.auditLog.groupBy({ by: ["actorType", "actorUserId"] });
  const ids = actors.filter(row => row.actorType === "USER" && row.actorUserId).map(row => row.actorUserId!);
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(users.map(user => [user.id, user]));
  const labels = { USER: "Alle Nutzer", SYSTEM: "System", ANONYMOUS: "Anonym", UNKNOWN: "Unbekannt" };
  const types = [...new Set(actors.map(row => row.actorType))].map(type => ({ value: `type:${type}`, label: labels[type] }));
  const individuals = ids.map(id => {
    if (id === RECOVERY_ADMIN_ID) return { value: `user:${id}`, label: "admin (Recovery)" };
    const user = byId.get(id);
    return { value: `user:${id}`, label: user ? user.name ? `${user.name} (${user.email})` : user.email : `Nutzer nicht mehr verfügbar (${id})` };
  }).sort((a, b) => a.label.localeCompare(b.label, "de"));
  return [...types, ...individuals];
}

// Authorize independently; neither companyId nor series ownership comes from
// client claims. A deleted series remains in AuditLog but has no detail page.
export async function getEventSeriesHistory(companySlug: string, seriesId: string, page = 1) {
  const { company } = await requireCompanyAccess(companySlug);
  const db = getPrisma();
  const series = await db.eventSeries.findFirst({ where: { id: seriesId, companyId: company.id }, select: { id: true } });
  if (!series) return null;
  return loadHistory({ model: "EventSeries", recordId: series.id, companyId: company.id }, page);
}

export async function getEventHistory(companySlug: string, eventId: string, page = 1) {
  const { company } = await requireCompanyAccess(companySlug);
  const event = await getPrisma().event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true } });
  if (!event) return null;
  return loadHistory({ model: "Event", recordId: event.id, companyId: company.id }, page);
}
