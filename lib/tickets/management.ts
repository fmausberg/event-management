import "server-only";
import { requireEventTicketAccess } from "./access";
import { getPrisma } from "@/lib/db/prisma";
import { canManageTicketReviews } from "@/lib/reviews/resend";
import { z } from "zod";

export async function getEventTickets(slug: string, eventId: string) {
 const { company, event, actor } = await requireEventTicketAccess(slug, eventId);
 const db = getPrisma();
 const tickets = await db.ticket.findMany({
  where: { booking: { eventId, event: { companyId: company.id } } },
  orderBy: [{ number: "asc" }],
  select: { id: true, number: true, status: true, checkedInAt: true, checkedInBy: { select: { email: true } }, booking: { select: { number: true, status: true, customerName: true, customerEmail: true, user: { select: { email: true } } } } },
 });
 const canManageReviews = await canManageTicketReviews(company.id, actor);
 const reviews = canManageReviews ? await db.eventReview.findMany({ where: { eventId: event.id },
  select: { recipientEmail: true, status: true, overallRating: true, submittedAt: true, sentAt: true } }) : [];
 const byEmail = new Map(reviews.map(review => [review.recipientEmail, review]));
 return { company, event, canManageReviews, tickets: tickets.map(ticket => {
  const email = (ticket.booking.customerEmail ?? ticket.booking.user?.email ?? "").trim().toLowerCase();
  const review = byEmail.get(email);
  const reviewInfo = canManageReviews ? {
   status: review?.status === "COMPLETED" ? "Abgegeben" : review?.overallRating ? "Vorläufig" : "Noch nicht abgegeben",
   submittedAt: review?.submittedAt?.toISOString() ?? null,
   sentAt: review?.sentAt?.toISOString() ?? null,
   unavailable: review?.status === "COMPLETED" ? "Bewertung bereits abgegeben."
    : !ticket.checkedInAt ? "Ticket noch nicht eingelöst."
    : !event.endsAt || event.endsAt > new Date() || !["PUBLISHED", "COMPLETED"].includes(event.status) ? "Erst nach Eventende verfügbar."
    : !z.email().safeParse(email).success ? "Keine gültige Buchungs-E-Mail vorhanden." : null,
  } : null;
  return { ...ticket, booking: { ...ticket.booking, customerEmail: ticket.booking.customerEmail ?? ticket.booking.user?.email ?? null }, reviewInfo };
 }) };
}
