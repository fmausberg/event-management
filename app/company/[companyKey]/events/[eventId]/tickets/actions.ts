"use server";
import { revalidatePath } from "next/cache";
import { MemberAccessError } from "@/lib/companies/members";
import { requireEventTicketAccess } from "@/lib/tickets/access";
import { getPrisma } from "@/lib/db/prisma";

export async function redeemCompanyTicket(slug: string, eventId: string, ticketId: string, _previous: { message?: string }, _form: FormData): Promise<{ message?: string }> {
 void _previous;
 void _form;
 try {
  const { company, actor } = await requireEventTicketAccess(slug, eventId);
  const result = await getPrisma().ticket.updateMany({
   where: { id: ticketId, status: "VALID", checkedInAt: null, booking: { eventId, status: "CONFIRMED", event: { companyId: company.id, status: { not: "CANCELLED" } } } },
   data: { checkedInAt: new Date(), checkedInById: actor },
  });
  revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/tickets`);
  return { message: result.count ? "Ticket eingelöst." : "Ticket bereits eingelöst, storniert oder nicht verfügbar." };
 } catch (error) {
  return { message: error instanceof MemberAccessError ? error.message : "Einlösen fehlgeschlagen. Bitte lade die Seite neu und prüfe den Status." };
 }
}
