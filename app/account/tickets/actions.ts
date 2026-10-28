"use server";
import { resendMyTicketEmail, type TicketMailState } from "@/lib/tickets/resend";

export async function resendTicketEmail(_previous: TicketMailState, form: FormData): Promise<TicketMailState> {
  const id = form.get("ticketId");
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(id)) return { message: "Tickets nicht verfügbar." };
  return resendMyTicketEmail(id);
}
