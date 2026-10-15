import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { MemberAccessError } from "@/lib/companies/members";
import { trainerIdentityForUser } from "@/lib/trainers/identity";

export async function requireEventTicketAccess(slug: string, eventId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, email: true } });
  if (!user) throw new MemberAccessError("UNAUTHENTICATED");
  const trainer = await trainerIdentityForUser(user);
  const event = await db.event.findFirst({
    where: {
      id: eventId, company: { slug },
      ...(user.role === "ADMIN" ? {} : { OR: [
        { company: { memberships: { some: { userId: user.id, status: "ACTIVE" as const } } } },
        { trainers: { some: { trainer } } },
        { staff: { some: { userId: user.id } } },
        { venue: { staff: { some: { userId: user.id } } } },
      ] }),
    },
    select: { id: true, name: true, beginsAt: true, status: true, company: { select: { id: true, name: true, slug: true } } },
  });
  if (!event) throw new MemberAccessError("FORBIDDEN");
  return { actor: user.id, company: event.company, event };
}
