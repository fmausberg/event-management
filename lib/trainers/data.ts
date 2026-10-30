import "server-only";
import { auth } from "@/auth";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { getCompanyEntityRatings } from "@/lib/reviews/entity-ratings";
import { ratingSummary } from "@/lib/reviews/summary";

export async function getCompanyTrainers(slug: string) {
  const { company } = await requireCompanyAccess(slug);
  const trainers = await getPrisma().trainer.findMany({
    where: { companyId: company.id }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    select: { id: true, number: true, firstName: true, lastName: true, email: true, _count: { select: { events: true, suggestedForSeries: true } } },
  });
  const accounts = trainers.length ? await getPrisma().user.findMany({
    where: { OR: trainers.map(({ email }) => ({ email: { equals: email, mode: "insensitive" as const } })) },
    select: { email: true, emailVerified: true },
  }) : [];
  const ratings = trainers.length ? await getCompanyEntityRatings(company.id, "trainer") : new Map<string, ReturnType<typeof ratingSummary>>();
  return { company, trainers: trainers.map((trainer) => {
    const matches = accounts.filter((account) => account.email.toLowerCase() === trainer.email.toLowerCase());
    const accountStatus: "missing" | "unverified" | "verified" = !matches.length ? "missing"
      : matches.some((account) => !!account.emailVerified) ? "verified" : "unverified";
    return { ...trainer, accountStatus, rating: ratings.get(trainer.id) ?? ratingSummary(0, 0) };
  }) };
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
