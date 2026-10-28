"use server";
import { resendCompanyBookingEmail, type TicketMailState } from "@/lib/tickets/resend";

export async function resendCompanyTickets(slug: string, eventId: string, bookingId: string, _previous: TicketMailState, form: FormData): Promise<TicketMailState> {
  const requestId = form.get("requestId");
  if (typeof requestId !== "string") return { message: "Ungültige Versandanfrage." };
  return resendCompanyBookingEmail(slug, eventId, bookingId, requestId);
}
