import "server-only";
import { auth } from "@/auth";
import { MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

export async function getMyTicket(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  return getPrisma().ticket.findFirst({
    where: { id, booking: { userId: session.user.id } },
    select: { id: true, number: true, status: true, checkedInAt: true,
      booking: { select: { number: true, status: true, event: { select: { name: true, beginsAt: true, status: true,
        venue: { select: { name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true } },
      } } } },
    },
  });
}
