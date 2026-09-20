import { getPrisma } from "@/lib/db/prisma";

export async function getEvent(id: string) {
  if (typeof id !== "string" || !id.trim()) return null;
  return getPrisma().event.findUnique({ where: { id } });
}
