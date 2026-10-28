import { z } from "zod";

export const usableTicketWhere = { status: "VALID" as const, checkedInAt: null };
export function ticketMailUnavailable(booking: { status: string; customerEmail: string | null; event: { status: string }; tickets: readonly unknown[] }) {
  if (booking.status !== "CONFIRMED") return "Die Buchung ist nicht bestätigt.";
  if (booking.event.status === "CANCELLED") return "Das Event ist storniert.";
  if (!booking.customerEmail || !z.email().safeParse(booking.customerEmail).success) return "Keine gültige Empfängeradresse in der Buchung gespeichert.";
  if (!booking.tickets.length) return "Keine gültigen, noch nicht eingelösten Tickets vorhanden.";
  return null;
}
