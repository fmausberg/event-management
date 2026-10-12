import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "./validation";

export async function findUserByEmail(email: string) {
  const normalized = emailSchema.parse(email);
  // Existing addresses may contain upper-case characters. Never pick an
  // arbitrary identity if legacy data contains case-insensitive duplicates.
  const users = await getPrisma().user.findMany({
    where: { email: { equals: normalized, mode: "insensitive" } }, take: 2,
  });
  if (users.length > 1) throw new Error("Ambiguous legacy email address");
  return users[0] ?? null;
}
