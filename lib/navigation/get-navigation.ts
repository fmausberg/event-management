import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { buildNavigation } from "./model";

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
          company: { select: { id: true, name: true } },
        },
      },
    },
  });
  return user ? buildNavigation(user) : null;
}
