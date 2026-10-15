import "server-only";
import { auth } from "@/auth";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";

export async function getCompanyTrainers(slug: string) {
  const { company } = await requireCompanyAccess(slug);
  const trainers = await getPrisma().trainer.findMany({
    where: { companyId: company.id }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    select: { id: true, number: true, firstName: true, lastName: true, email: true, _count: { select: { events: true, suggestedForSeries: true } } },
  });
  return { company, trainers };
}

export async function getTrainerCompanies() {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!user) throw new MemberAccessError("FORBIDDEN");
  return db.company.findMany({
    where: user.role === "ADMIN" ? {} : { memberships: { some: { userId: session.user.id, status: "ACTIVE" } } },
    select: { id: true, name: true, slug: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
