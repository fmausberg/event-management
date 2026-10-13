import "server-only";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

export async function getCompanySeries(slug: string, adminOnly = false) {
  const { company, canManage } = await requireCompanyAccess(slug, adminOnly);
  const db = getPrisma();
  const [series, venues] = await Promise.all([
    db.eventSeries.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
      id: true, number: true, name: true, shortdescription: true, description: true, imageUrl: true,
      suggestedMaxSeats: true, suggestedTicketPrice: true, suggestedCurrency: true, suggestedTrainerName: true, suggestedVenueId: true,
      _count: { select: { events: true } },
    } }),
    db.venue.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  return { company, canManage, venues, series: series.map((row) => ({ ...row, suggestedTicketPrice: row.suggestedTicketPrice?.toFixed(2) ?? null })) };
}
