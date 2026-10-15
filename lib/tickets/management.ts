import "server-only";
import { requireEventTicketAccess } from "./access";
import { getPrisma } from "@/lib/db/prisma";

export async function getEventTickets(slug: string, eventId: string) {
 const { company, event } = await requireEventTicketAccess(slug, eventId);
 const db = getPrisma();
 const tickets = await db.ticket.findMany({
  where: { booking: { eventId, event: { companyId: company.id } } },
  orderBy: [{ number: "asc" }],
  select: { id: true, number: true, status: true, checkedInAt: true, checkedInBy: { select: { email: true } }, booking: { select: { number: true, status: true, customerEmail: true } } },
 });
 return { company, event, tickets };
}
