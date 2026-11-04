import "server-only";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

// Authorize independently; neither companyId nor series ownership comes from
// client claims. A deleted series remains in AuditLog but has no detail page.
export async function getEventSeriesHistory(companySlug: string, seriesId: string, page = 1) {
  const { company } = await requireCompanyAccess(companySlug);
  const db = getPrisma();
  const series = await db.eventSeries.findFirst({ where: { id: seriesId, companyId: company.id }, select: { id: true } });
  if (!series) return null;
  const currentPage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000000) : 1;
  const rows = await db.auditLog.findMany({
    where: { model: "EventSeries", recordId: series.id, companyId: company.id },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (currentPage - 1) * 20, take: 21,
    select: { id: true, action: true, occurredAt: true, actorType: true, actorUserId: true, source: true, correlationId: true, changedFields: true, redactedFields: true, before: true, after: true },
  });
  const entries = rows.slice(0, 20);
  const actorIds = [...new Set(entries.filter((row) => row.actorType === "USER" && row.actorUserId).map((row) => row.actorUserId!))];
  // Current email is presentation data, never duplicated into immutable audit JSON.
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
  const emails = new Map(actors.map((actor) => [actor.id, actor.email]));
  return { entries: entries.map((entry) => ({ ...entry, actorEmail: entry.actorUserId ? emails.get(entry.actorUserId) ?? null : null })), hasNext: rows.length > 20, page: currentPage };
}
