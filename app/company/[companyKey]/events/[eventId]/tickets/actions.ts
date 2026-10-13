"use server";
import { revalidatePath } from "next/cache";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";

export async function redeemCompanyTicket(slug: string, eventId: string, ticketId: string, _previous: { message?: string }, _form: FormData): Promise<{ message?: string }> {
 void _previous;
 void _form;
 try {
  const { company } = await requireCompanyAccess(slug);
  const actor = (await auth())?.user?.id;
  if (!actor) throw new MemberAccessError("UNAUTHENTICATED");
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
