import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

// Only a verified address can claim a membership created before registration.
export async function claimMemberships(user: { id: string; email: string; emailVerified: Date | null }) {
  if (!user.emailVerified) return;
  const db = getPrisma();
  const email = user.email.trim().toLowerCase();
  const identities = await db.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true }, take: 2 });
  if (identities.length !== 1 || identities[0].id !== user.id) return;
  try {
    await db.companyMembership.updateMany({
      where: { email, userId: null, status: "INVITED", company: { memberships: { none: { userId: user.id } } } },
      data: { userId: user.id, status: "ACTIVE" },
    });
  } catch (error) {
    // A concurrent admin assignment must not break login. Retry other pending
    // memberships on the next session read; never overwrite existing roles.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
}
