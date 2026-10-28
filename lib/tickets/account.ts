import "server-only";
import { auth } from "@/auth";
import { MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { ticketPresentationSelect, toTicketViewModel } from "./presentation";
import { decryptTicketCode } from "./code-encryption";

export async function getMyTicket(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  const ticket = await getPrisma().ticket.findFirst({
    where: { id, booking: { userId: session.user.id } },
    select: { ...ticketPresentationSelect, id: true, publicTokenHash: true, encryptedPublicToken: true,
      booking: { select: { ...ticketPresentationSelect.booking.select, number: true } },
    },
  });
  if (!ticket) return null;
  const view = toTicketViewModel(ticket);
  return { id: ticket.id, bookingNumber: ticket.booking.number, ticket: view,
    code: view.status === "Gültig" ? decryptTicketCode(ticket.encryptedPublicToken, ticket.publicTokenHash) : null };
}
