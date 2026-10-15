import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

// Called inside the verification transaction, or a serializable login retry.
export async function claimVerifiedAssignments(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerified: true } });
  if (!user?.emailVerified) return;
  const email = { equals: user.email.trim().toLowerCase(), mode: "insensitive" as const };
  const identities = await tx.user.findMany({ where: { email }, select: { id: true }, take: 2 });
  if (identities.length !== 1 || identities[0].id !== user.id) return;
  await tx.companyMembership.updateMany({
    where: { email, userId: null, status: { in: ["ACTIVE", "INVITED"] }, company: { memberships: { none: { userId } } } },
    data: { userId, status: "ACTIVE" },
  });
  await tx.venueStaff.updateMany({ where: { email, userId: null, venue: { staff: { none: { userId } } } }, data: { userId } });
  await tx.eventStaff.updateMany({ where: { email, userId: null, event: { staff: { none: { userId } } } }, data: { userId } });
  const profiles = await tx.trainer.findMany({ where: { email }, select: { id: true, companyId: true, userId: true } });
  const counts = new Map<string, number>();
  for (const profile of profiles) counts.set(profile.companyId, (counts.get(profile.companyId) ?? 0) + 1);
  const ids = profiles.filter((profile) => profile.userId === null && counts.get(profile.companyId) === 1).map((profile) => profile.id);
  if (ids.length) await tx.trainer.updateMany({ where: { id: { in: ids }, email, userId: null }, data: { userId } });
}

export async function claimMemberships(user: { id: string; email: string; emailVerified: Date | null }) {
  if (!user.emailVerified) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await getPrisma().$transaction((tx) => claimVerifiedAssignments(tx, user.id), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error;
    }
  }
}
