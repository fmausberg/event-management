import "server-only";
import type { Prisma } from "@prisma/client";
import { createTicketToken } from "@/lib/tickets/public-token";
import { ticketLink } from "@/lib/tickets/public-link";
import { bookingConfirmation } from "@/lib/mail/templates/booking-confirmation";
import { enqueueInitialTicketMail } from "@/lib/tickets/outbox";

/** Only call on the atomic transition to CONFIRMED, never on an already confirmed replay. */
export async function issueBookingTickets(tx: Prisma.TransactionClient, booking: {
  id: string; number: number; quantity: number; customerName: string | null; customerEmail: string | null;
}, event: { name: string; beginsAt: Date | null }, paymentId?: string) {
  if (!booking.customerEmail || !booking.customerName) throw new Error("Missing booking contact");
  const tokens = Array.from({ length: booking.quantity }, () => createTicketToken());
  await tx.ticket.createMany({ data: tokens.map(({ publicTokenHash, encryptedPublicToken }) => ({
    bookingId: booking.id, status: "VALID", publicTokenHash, encryptedPublicToken,
  })) });
  return enqueueInitialTicketMail(tx, booking.id, { to: booking.customerEmail, ...bookingConfirmation({
    customerName: booking.customerName, bookingNumber: booking.number, eventName: event.name,
    beginsAt: event.beginsAt, quantity: booking.quantity, ticketLinks: tokens.map(({ token }) => ticketLink(token)),
  }) }, paymentId);
}
