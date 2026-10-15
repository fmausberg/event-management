import "server-only";
import { getPrisma } from "@/lib/db/prisma";

export async function trainerIdentityForUser(user: { id: string; email: string }) {
  const email = { equals: user.email.trim().toLowerCase(), mode: "insensitive" as const };
  const identities = await getPrisma().user.findMany({ where: { email }, select: { id: true }, take: 2 });
  const uniqueEmail = identities.length === 1 && identities[0].id === user.id;
  return { OR: [{ userId: user.id }, ...(uniqueEmail ? [{ userId: null, email }] : [])] };
}
