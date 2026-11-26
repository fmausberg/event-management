import "server-only";
import { eligibleVenueApprovalMember } from "@/lib/venues/approval-members";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

export async function getCompanySeries(slug: string, adminOnly = false) {
  const { company, canManage } = await requireCompanyAccess(slug, adminOnly);
  const db = getPrisma();
  const [series, venues, trainers] = await Promise.all([
    db.eventSeries.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
      id: true, number: true, name: true, shortdescription: true, description: true, imageUrl: true,
      suggestedFreeCancellationUntilMinutesBeforeStart: true, suggestedDuration: true, suggestedMaxSeats: true, suggestedTicketPrice: true, suggestedCurrency: true, suggestedTrainerName: true, suggestedTrainerId: true, suggestedVenueId: true,
      _count: { select: { events: true } },
    } }),
    db.venue.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, _count: { select: { staff: { where: eligibleVenueApprovalMember } } } } }),
    db.trainer.findMany({ where: { companyId: company.id }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], select: { id: true, firstName: true, lastName: true, email: true } }),
  ]);
  const connection = await db.eventbriteConnection.findUnique({ where: { companyId: company.id }, select: { status: true } });
  const eventbriteConnected = connection?.status === "CONNECTED";
  return { company, canManage, eventbriteConnected, venues: venues.map(({ _count, ...venue }) => ({ ...venue, hasApprovalTeam: _count.staff > 0 })), trainers, series: series.map((row) => ({ ...row, suggestedTicketPrice: row.suggestedTicketPrice?.toFixed(2) ?? null })) };
}
