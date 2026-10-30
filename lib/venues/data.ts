import "server-only";
import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { getCompanyEntityRatings } from "@/lib/reviews/entity-ratings";
import { ratingSummary } from "@/lib/reviews/summary";
export async function getCompanyVenues(slug: string) {
 const { company } = await requireCompanyAccess(slug);
 const venues = await getPrisma().venue.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
 id: true, number: true, name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true,
 _count: { select: { events: true, suggestedForSeries: true } },
 } });
 const ratings = venues.length ? await getCompanyEntityRatings(company.id, "venue") : new Map<string, ReturnType<typeof ratingSummary>>();
 return { company, venues: venues.map(venue => ({ ...venue, rating: ratings.get(venue.id) ?? ratingSummary(0, 0) })) };
}
