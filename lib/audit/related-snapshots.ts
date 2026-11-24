import "server-only";
import type { Prisma } from "@prisma/client";

const eventIdentity = { companyId: true, number: true, name: true } as const;
const bookingIdentity = { number: true, event: { select: { companyId: true } } } as const;
const noteSelect = {
  id: true, number: true, body: true, authorId: true, visibility: true, createdAt: true,
  eventId: true, event: { select: eventIdentity },
  eventSeriesId: true, eventSeries: { select: eventIdentity },
  venueId: true, venue: { select: eventIdentity },
  trainerId: true, trainer: { select: { companyId: true, number: true, firstName: true, lastName: true } },
  bookingId: true, booking: { select: bookingIdentity },
  ticketId: true, ticket: { select: { number: true, booking: { select: { event: { select: { companyId: true } } } } } },
  cancellationRequestId: true, cancellationRequest: { select: { booking: { select: bookingIdentity } } },
} satisfies Prisma.NoteSelect;

type NoteSnapshot = Prisma.NoteGetPayload<{ select: typeof noteSelect }>;
function noteTarget(note: NoteSnapshot) {
  const targets = [
    note.event && { model: "Event", id: note.eventId!, companyId: note.event.companyId, number: note.event.number, name: note.event.name, label: "Event" },
    note.eventSeries && { model: "EventSeries", id: note.eventSeriesId!, companyId: note.eventSeries.companyId, number: note.eventSeries.number, name: note.eventSeries.name, label: "Veranstaltungsreihe" },
    note.venue && { model: "Venue", id: note.venueId!, companyId: note.venue.companyId, number: note.venue.number, name: note.venue.name, label: "Ort" },
    note.trainer && { model: "Trainer", id: note.trainerId!, companyId: note.trainer.companyId, number: note.trainer.number, name: `${note.trainer.firstName} ${note.trainer.lastName}`, label: "Trainer" },
    note.booking && { model: "Booking", id: note.bookingId!, companyId: note.booking.event.companyId, number: note.booking.number, name: null, label: "Buchung" },
    note.ticket && { model: "Ticket", id: note.ticketId!, companyId: note.ticket.booking.event.companyId, number: note.ticket.number, name: null, label: "Ticket" },
    note.cancellationRequest && { model: "CancellationRequest", id: note.cancellationRequestId!, companyId: note.cancellationRequest.booking.event.companyId, number: null, name: null, label: "Stornierungsanfrage" },
  ].filter(target => target !== null);
  if (targets.length !== 1) throw new Error("Audit: Eine Notiz muss genau einem Zielobjekt zugeordnet sein.");
  return targets[0];
}

/** Explicit metadata only. Bodies are compared transiently and never become audit JSON. */
export async function relatedAuditSnapshots(tx: Prisma.TransactionClient, delegate: string) {
  if (delegate === "note") {
    const notes = await tx.note.findMany({ select: noteSelect });
    return notes.map(note => {
      const target = noteTarget(note);
      return {
        id: note.id, number: note.number, companyId: target.companyId,
        authorId: note.authorId, visibility: note.visibility, createdAt: note.createdAt, body: note.body,
        targetModel: target.model, targetId: target.id, targetNumber: target.number,
        name: `Notiz zu ${target.label}${target.number == null ? "" : ` #${target.number}`}${target.name ? `: ${target.name}` : ""}`,
      };
    });
  }
  if (delegate === "eventTrainer") {
    const assignments = await tx.eventTrainer.findMany({ select: {
      id: true, number: true, eventId: true, trainerId: true, responseStatus: true, respondedAt: true, createdAt: true,
      event: { select: { companyId: true } }, trainer: { select: { firstName: true, lastName: true } },
    } });
    return assignments.map(({ event, trainer, ...assignment }) => ({
      ...assignment, companyId: event.companyId, name: `${trainer.firstName} ${trainer.lastName}`,
    }));
  }
  return null;
}
