import "server-only";
import type { Prisma } from "@prisma/client";
import type { TicketViewModel } from "./view-model";

// Both access paths select the same display fields after their own access check.
export const ticketPresentationSelect = {
  number: true, status: true, checkedInAt: true,
  booking: { select: { status: true, customerName: true, event: { select: {
    name: true, beginsAt: true, status: true,
    venue: { select: { name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true } },
  } } } },
} satisfies Prisma.TicketSelect;

type TicketPresentationRecord = Prisma.TicketGetPayload<{ select: typeof ticketPresentationSelect }>;

/** Presentation only: does not authorize access, issue tokens or permit check-in. */
export function toTicketViewModel(ticket: TicketPresentationRecord): TicketViewModel {
  const event = ticket.booking.event;
  const cancelled = ticket.status === "CANCELLED" || ticket.booking.status === "CANCELLED" || event.status === "CANCELLED";
  const venue = event.venue;
  return {
    number: ticket.number,
    status: cancelled ? "Storniert" : ticket.checkedInAt ? "Bereits eingelöst" : ticket.booking.status === "CONFIRMED" ? "Gültig" : "Nicht gültig",
    checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
    eventName: event.name,
    bookedByName: ticket.booking.customerName,
    beginsAt: event.beginsAt?.toISOString() ?? "",
    venue: venue ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
  };
}
