import "server-only";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";

export async function getCompaniesForAdmin() {
  await requireAdmin();
  return getPrisma().company.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true, number: true, name: true, slug: true,
      _count: { select: { memberships: true, venues: true, eventSeries: true, events: true } },
    },
  });
}
