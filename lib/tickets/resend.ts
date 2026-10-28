import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { sendMail } from "@/lib/mail";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";
import { decryptTicketCode, TicketCodeError } from "./code-encryption";
import { ticketLink } from "./public-link";

export type TicketMailState = { success?: boolean; message?: string };

// Explicit resend, independent of the initial Stripe outbox. Never resets its
// sentAt/lock or changes ticket data; failed SMTP can safely be retried by owner.
export async function resendMyTicketEmail(ticketId: string): Promise<TicketMailState> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { message: "Bitte melde dich an." };
    if (!await consumeAuthAttempt(session.user.id, "ticket-mail")) return { message: "Zu viele Anfragen. Bitte versuche es in 15 Minuten erneut." };
    const ticket = await getPrisma().ticket.findFirst({
      where: { id: ticketId, booking: { userId: session.user.id } },
      select: { booking: { select: { number: true, status: true, customerName: true, customerEmail: true, quantity: true,
        event: { select: { name: true, beginsAt: true, status: true } },
        tickets: { orderBy: { number: "asc" }, select: { publicTokenHash: true, encryptedPublicToken: true } },
      } } },
    });
    if (!ticket || ticket.booking.status !== "CONFIRMED" || ticket.booking.event.status === "CANCELLED" || !ticket.booking.customerEmail || !ticket.booking.tickets.length) return { message: "Tickets nicht verfügbar." };
    const booking = ticket.booking;
    const ticketLinks = booking.tickets.map((item) => ticketLink(decryptTicketCode(item.encryptedPublicToken, item.publicTokenHash)));
    await sendMail({ to: booking.customerEmail!, ...bookingConfirmation({
      customerName: booking.customerName ?? "", bookingNumber: booking.number,
      eventName: booking.event.name, beginsAt: booking.event.beginsAt, quantity: booking.quantity, ticketLinks,
    }) });
    return { success: true, message: "Die Tickets wurden erneut an die E-Mail-Adresse der Buchung gesendet." };
  } catch (error) {
    console.error("[tickets:resend] Delivery failed", error instanceof TicketCodeError ? error.reason : "DELIVERY");
    return { message: "Die Ticket-E-Mail konnte nicht versendet werden. Bitte versuche es später erneut. Deine Buchung bleibt unverändert." };
  }
}
