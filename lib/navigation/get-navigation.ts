import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { buildNavigation } from "./model";
import { trainerIdentityForUser } from "@/lib/trainers/identity";

export async function getNavigation() {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Read current roles from the database, never from client input or stale JWT claims.
  const user = await getPrisma().user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true, email: true, role: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: [{ company: { name: "asc" } }, { companyId: "asc" }],
        select: {
          role: true, status: true,
          company: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
  if (!user) return null;
  const db = getPrisma();
  const trainerIdentity = await trainerIdentityForUser({ id: session.user.id, email: user.email });
  const [trainer, eventStaff, venueStaff] = await Promise.all([
    db.trainer.findFirst({ where: trainerIdentity, select: { id: true } }),
    db.eventStaff.findFirst({ where: { userId: session.user.id }, select: { id: true } }),
    db.venueStaff.findFirst({ where: { userId: session.user.id }, select: { id: true } }),
  ]);
  return buildNavigation(user, !!(trainer || eventStaff || venueStaff));
}
