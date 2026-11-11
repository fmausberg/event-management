import "server-only";
import type { Prisma } from "@prisma/client";

// Drafts and published events that have not started; cancelled/completed dates do not block removal.
export function upcomingTaxEvents(companyId: string, countryCode: string, now: Date): Prisma.EventWhereInput {
 return { companyId, beginsAt: { gt: now }, status: { in: ["DRAFT", "PUBLISHED"] }, venue: { companyId, countryCode } };
}
export const inheritsCountryTax: Prisma.EventWhereInput = {
 taxRateOverride: null, OR: [{ eventSeriesId: null }, { eventSeries: { taxRateOverride: null } }],
};
export async function countryTaxUsage(tx: Prisma.TransactionClient, companyId: string, countryCode: string, now: Date) {
 const where = upcomingTaxEvents(companyId, countryCode, now);
 const [upcomingCount, affectedCount] = await Promise.all([
  tx.event.count({ where }), tx.event.count({ where: { AND: [where, inheritsCountryTax] } }),
 ]);
 return { upcomingCount, affectedCount };
}
