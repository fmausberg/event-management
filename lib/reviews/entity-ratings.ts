import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { ratingSummary } from "./summary";

/** Internal helper: callers authorize company access before providing its ID.
 * Aggregate per event in SQL, then combine sums/counts, never averages of averages.
 * A shared event trainer score applies to each explicit EventTrainer assignment.
 */
export async function getCompanyEntityRatings(companyId: string, category: "trainer" | "venue") {
  const db = getPrisma();
  const field = category === "trainer" ? "trainerRating" : "locationRating";
  const grouped = await db.eventReview.groupBy({
    by: ["eventId"],
    where: { status: "COMPLETED", submittedAt: { not: null }, [field]: { not: null }, event: { companyId } },
    _sum: { trainerRating: true, locationRating: true },
    _count: { trainerRating: true, locationRating: true },
  });
  if (!grouped.length) return new Map<string, ReturnType<typeof ratingSummary>>();
  const events = await db.event.findMany({
    where: { companyId, id: { in: grouped.map(group => group.eventId) } },
    select: { id: true,
      trainers: { where: { trainer: { companyId } }, select: { trainerId: true } },
      venue: { select: { id: true, companyId: true } },
    },
  });
  const assignments = new Map(events.map(event => [event.id, category === "trainer"
    ? event.trainers.map(trainer => trainer.trainerId)
    : event.venue?.companyId === companyId ? [event.venue.id] : []]));
  const totals = new Map<string, { sum: number; count: number }>();
  for (const group of grouped) {
    for (const id of assignments.get(group.eventId) ?? []) {
      const total = totals.get(id) ?? { sum: 0, count: 0 };
      total.sum += group._sum[field] ?? 0;
      total.count += group._count[field];
      totals.set(id, total);
    }
  }
  return new Map([...totals].map(([id, { sum, count }]) => [id, ratingSummary(sum, count)]));
}
