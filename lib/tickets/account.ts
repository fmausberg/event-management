import "server-only";
import { auth } from "@/auth";
import { MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { ticketPresentationSelect, toTicketViewModel } from "./presentation";

export async function getMyTicket(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  const ticket = await getPrisma().ticket.findFirst({
    where: { id, booking: { userId: session.user.id } },
    select: { ...ticketPresentationSelect, id: true,
      booking: { select: { ...ticketPresentationSelect.booking.select, number: true } },
    },
  });
  return ticket ? { id: ticket.id, bookingNumber: ticket.booking.number, ticket: toTicketViewModel(ticket) } : null;
}
