import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { requireEventTicketAccess } from "@/lib/tickets/access";
import { MemberAccessError } from "@/lib/companies/members";
import { hashReviewToken } from "./token";
import { REVIEW_LIFETIME_MS } from "./validation";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { eventReviewMessage } from "@/lib/mail/templates/event-review";
import { accountOrigin } from "@/lib/auth/verification";
import { deliverEncryptedMail } from "@/lib/tickets/outbox";

export async function canManageTicketReviews(companyId: string, actor: string) {
  const member = await getPrisma().companyMembership.findUnique({ where: { companyId_userId: { companyId, userId: actor } }, select: { role: true, status: true } });
  return member?.status === "ACTIVE" && ["COMPANY_USER", "COMPANY_ADMIN"].includes(member.role);
}

export async function resendReviewInvitation(slug: string, eventId: string, ticketId: string, requestId: string) {
  const { company, actor } = await requireEventTicketAccess(slug, eventId);
  if (!await canManageTicketReviews(company.id, actor)) throw new MemberAccessError("FORBIDDEN");
  if (!z.uuid().safeParse(requestId).success) return { message: "Ungültige Versandanfrage." };
  const db = getPrisma();
  const result = await db.$transaction(async tx => {
    const now = new Date();
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, booking: { eventId, event: { companyId: company.id } } },
      include: { booking: { include: { user: { select: { email: true } }, event: true } } } });
    if (!ticket?.checkedInAt) return { message: "Das Ticket wurde noch nicht eingelöst." };
    const { booking } = ticket;
    if (!booking.event.endsAt || booking.event.endsAt > now || !["PUBLISHED", "COMPLETED"].includes(booking.event.status)) return { message: "Bewertungsaufforderungen sind erst nach Eventende möglich." };
    const recipientEmail = (booking.customerEmail ?? booking.user?.email ?? "").trim().toLowerCase();
    if (!z.email().safeParse(recipientEmail).success) return { message: "Keine gültige Buchungs-E-Mail vorhanden." };
    let review = await tx.eventReview.findUnique({ where: { eventId_recipientEmail: { eventId, recipientEmail } } });
    if (review?.status === "COMPLETED") return { message: "Die Bewertung wurde bereits abgegeben." };
    const previous = await tx.eventReviewResendToken.findUnique({ where: { requestId } });
    if (previous) {
      if (!review || previous.reviewId !== review.id) return { message: "Ungültige Versandanfrage." };
      return { message: "Versand bereits beauftragt.", queued: true };
    }
    const mail = review ? await tx.mailOutbox.findUnique({ where: { reviewId: review.id } }) : null;
    if (mail?.lockedUntil && mail.lockedUntil > now) return { message: "Eine E-Mail wird gerade versendet. Bitte versuche es danach erneut." };
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashReviewToken(token);
    const expiresAt = new Date(now.getTime() + REVIEW_LIFETIME_MS);
    if (!review) review = await tx.eventReview.create({ data: { eventId, bookingId: booking.id, ticketId: ticket.id, recipientEmail, tokenHash, expiresAt } });
    else await tx.eventReview.update({ where: { id: review.id }, data: { expiresAt } });
    await tx.eventReviewResendToken.create({ data: { requestId, tokenHash, reviewId: review.id } });
    // Reuse the existing delivery slot. Serializable isolation + lease check keeps
    // a manual resend from replacing a message while another worker is sending it.
    const payload = { encryptedMessage: encryptPaymentMail({ to: recipientEmail, ...eventReviewMessage(booking.event.name, accountOrigin(), token) }),
      sentAt: null, cancelledAt: null, lockToken: null, lockedUntil: null, availableAt: now, attempts: 0, lastError: null };
    const queued = await tx.mailOutbox.upsert({ where: { reviewId: review.id },
      create: { reviewId: review.id, kind: "EVENT_REVIEW", requestKey: `event-review:${review.id}`, ...payload }, update: payload });
    return { mailId: queued.id, queued: true, message: "Versand beauftragt." };
  }, { isolationLevel: "Serializable" });
  if (result.mailId) {
    try { if (await deliverEncryptedMail(result.mailId, "review")) return { queued: true, message: "Bewertungsaufforderung versendet." }; }
    catch { return { queued: true, message: "Versand beauftragt. Bei Versandproblemen wird automatisch erneut versucht." }; }
  }
  return { queued: result.queued, message: result.message };
}
