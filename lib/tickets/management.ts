import "server-only";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

export async function getEventTickets(slug: string, eventId: string) {
 const { company } = await requireCompanyAccess(slug);
 const db = getPrisma();
 const event = await db.event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true, name: true, beginsAt: true, status: true } });
 if (!event) throw new MemberAccessError("NOT_FOUND");
 const tickets = await db.ticket.findMany({
  where: { booking: { eventId, event: { companyId: company.id } } },
  orderBy: [{ number: "asc" }],
  select: { id: true, number: true, status: true, checkedInAt: true, checkedInBy: { select: { email: true } }, booking: { select: { number: true, status: true, customerEmail: true } } },
 });
 return { company, event, tickets };
}
