import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

// Memberships are effective immediately; email verification is informational.
export async function claimMemberships(user: { id: string; email: string; emailVerified: Date | null }) {
  const db = getPrisma();
  const email = user.email.trim().toLowerCase();
  const identities = await db.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true }, take: 2 });
  if (identities.length !== 1 || identities[0].id !== user.id) return;
  try {
    await db.companyMembership.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, userId: null, status: { in: ["ACTIVE", "INVITED"] }, company: { memberships: { none: { userId: user.id } } } },
      data: { userId: user.id, status: "ACTIVE" },
    });
  } catch (error) {
    // A concurrent admin assignment must not break login. Retry other pending
    // memberships on the next session read; never overwrite existing roles.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  // Never take assignments away from another account or create a duplicate
  // assignment for the same user and venue/event. Verification is informational.
  for (const claim of [
    () => db.venueStaff.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, userId: null, venue: { staff: { none: { userId: user.id } } } },
      data: { userId: user.id },
    }),
    () => db.eventStaff.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, userId: null, event: { staff: { none: { userId: user.id } } } },
      data: { userId: user.id },
    }),
  ]) {
    try { await claim(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
}
