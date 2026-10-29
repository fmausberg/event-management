import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { decryptTicketCode, TicketCodeError } from "./code-encryption";
import { ticketLink } from "./public-link";
import { ticketMailUnavailable, usableTicketWhere } from "./mail-policy";
import { deliverTicketMail } from "./outbox";

export type TicketMailState = { success?: boolean; message?: string };
type Access = { ticketId: string } | { bookingId: string; eventId: string; companySlug: string };
class MailRuleError extends Error {}
const id = z.string().min(1).max(191);

async function queueResend(access: Access, requestId: string): Promise<TicketMailState> {
  try {
    if (!z.uuid().safeParse(requestId).success || !Object.values(access).every((value) => id.safeParse(value).success)) return { message: "Ungültige Versandanfrage." };
    const actorId = (await auth())?.user?.id;
    if (!actorId) return { message: "Bitte melde dich an." };
    // Retry serialization/unique conflicts; the same request key survives retries.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await getPrisma().$transaction(async (tx) => {
          const owner = "ticketId" in access;
          const booking = await tx.booking.findFirst({
            where: owner ? { userId: actorId, tickets: { some: { id: access.ticketId } } } : {
              id: access.bookingId, eventId: access.eventId, event: { company: { slug: access.companySlug } },
            },
            select: { id: true, number: true, status: true, customerName: true, customerEmail: true,
              event: { select: { companyId: true, status: true, name: true, beginsAt: true } },
              tickets: { where: usableTicketWhere, orderBy: { number: "asc" }, select: { publicTokenHash: true, encryptedPublicToken: true } },
            },
          });
          if (!booking) throw new MailRuleError("Buchung nicht verfügbar oder keine Berechtigung.");
          if (!owner) {
            const member = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: booking.event.companyId, userId: actorId } }, select: { role: true, status: true } });
            if (!member || member.status !== "ACTIVE" || !["COMPANY_USER", "COMPANY_ADMIN"].includes(member.role)) throw new MailRuleError("Buchung nicht verfügbar oder keine Berechtigung.");
          }
          const requestKey = `resend:${actorId}:${booking.id}:${requestId}`;
          const existing = await tx.ticketMail.findUnique({ where: { requestKey }, select: { id: true, sentAt: true } });
          if (existing) return { created: false, bookingId: booking.id, jobId: existing.id, sent: !!existing.sentAt };
          const reason = ticketMailUnavailable(booking);
          if (reason) throw new MailRuleError(reason);
          const now = Date.now(), window = Math.floor(now / 900_000);
          for (const scope of [`actor:${actorId}`, `booking:${booking.id}`]) {
            const key = `ticket-mail:${scope}:${window}`;
            const rate = await tx.authRateLimit.upsert({ where: { key }, create: { key, attempts: 1, expiresAt: new Date((window + 1) * 900_000) }, update: { attempts: { increment: 1 } } });
            if (rate.attempts > 5) throw new MailRuleError("Zu viele Versandanfragen für diesen Nutzer oder diese Buchung. Bitte in 15 Minuten erneut versuchen.");
          }
          const ticketLinks = booking.tickets.map((ticket) => ticketLink(decryptTicketCode(ticket.encryptedPublicToken, ticket.publicTokenHash)));
          const encryptedMessage = encryptPaymentMail({ to: booking.customerEmail!, ...bookingConfirmation({
            customerName: booking.customerName ?? "", bookingNumber: booking.number, eventName: booking.event.name,
            beginsAt: booking.event.beginsAt, quantity: ticketLinks.length, ticketLinks,
          }) });
          const job = await tx.ticketMail.create({ data: { requestKey, bookingId: booking.id, requestedById: actorId, encryptedMessage }, select: { id: true } });
          return { created: true, bookingId: booking.id, jobId: job.id, sent: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (result.created) console.info("[tickets:resend] Queued", { actorId, bookingId: result.bookingId, jobId: result.jobId });
        // Send only after commit, through the same lease-protected outbox as the
        // background worker. SMTP failures must never rerun the queue transaction.
        let sent = result.sent;
        if (!sent) {
          try { sent = await deliverTicketMail(result.jobId); }
          catch { /* The persisted job remains available for background retries. */ }
        }
        return { success: true, message: sent
          ? "Die Ticket-E-Mail wurde an den Mailserver übergeben."
          : "Der Versandauftrag ist gespeichert, aber der Versand ist noch nicht bestätigt. Der Hintergrundversand versucht es erneut." };
      } catch (error) {
        if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) continue;
        throw error;
      }
    }
    return { message: "Bitte versuche die Versandanfrage erneut." };
  } catch (error) {
    if (error instanceof MailRuleError) return { message: error.message };
    console.error("[tickets:resend] Queue failed", error instanceof TicketCodeError ? error.reason : "QUEUE_FAILED");
    return { message: "Der Versand konnte nicht beauftragt werden. Bitte versuche es erneut." };
  }
}

export async function resendMyTicketEmail(ticketId: string, requestId: string) {
  return queueResend({ ticketId }, requestId);
}
export async function resendCompanyBookingEmail(companySlug: string, eventId: string, bookingId: string, requestId: string) {
  return queueResend({ companySlug, eventId, bookingId }, requestId);
}
