import "server-only";
import { RECOVERY_ADMIN_ID, recoveryAdminAvailable } from "./recovery-admin";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";

export class AdminAccessError extends Error {
  constructor(public readonly reason: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(reason === "UNAUTHENTICATED"
      ? "Bitte melde dich erneut an."
      : "Für diese Aktion benötigst du Administratorrechte.");
  }
}

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new AdminAccessError("UNAUTHENTICATED");
  if (session.user.id === RECOVERY_ADMIN_ID) {
    if (!await recoveryAdminAvailable()) throw new AdminAccessError("FORBIDDEN");
    return { id: RECOVERY_ADMIN_ID, role: "ADMIN" as const };
  }
  const user = await getPrisma().user.findUnique({
    where: { id: session.user.id }, select: { id: true, role: true },
  });
  if (user?.role !== "ADMIN") throw new AdminAccessError("FORBIDDEN");
  return user;
}
