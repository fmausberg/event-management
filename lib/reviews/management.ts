import "server-only";
import { requireBookingEvent } from "@/lib/bookings/management";
import { getPrisma } from "@/lib/db/prisma";

export async function getReviewSummary(companySlug: string, eventId: string) {
  const context = await requireBookingEvent(companySlug, eventId);
  const db = getPrisma();
  const where = { eventId: context.event.id };
  const [invited, sent, provisional, completed, scores] = await Promise.all([
    db.eventReview.count({ where }),
    db.eventReview.count({ where: { ...where, sentAt: { not: null } } }),
    db.eventReview.count({ where: { ...where, status: "PROVISIONAL", overallRating: { not: null } } }),
    db.eventReview.count({ where: { ...where, status: "COMPLETED" } }),
    db.eventReview.aggregate({ where: { ...where, status: "COMPLETED" },
      _avg: { overallRating: true, trainerRating: true, locationRating: true, organizationRating: true },
      _count: { overallRating: true, trainerRating: true, locationRating: true, organizationRating: true },
    }),
  ]);
  return { ...context, invited, sent, provisional, completed, scores };
}
