import "server-only";
import { requireCompanyAdmin } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
export async function getCompanyVenues(slug: string) {
 const company = await requireCompanyAdmin(slug);
 const venues = await getPrisma().venue.findMany({ where: { companyId: company.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
 id: true, number: true, name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true,
 _count: { select: { events: true, suggestedForSeries: true } },
 } });
 return { company, venues };
}
