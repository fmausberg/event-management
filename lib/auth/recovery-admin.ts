import "server-only";
import { getPrisma } from "@/lib/db/prisma";

// Virtual identity: never persist a fallback admin that would disable recovery itself.
export const RECOVERY_ADMIN_ID = "__recovery_admin__";

export async function recoveryAdminAvailable() {
  return await getPrisma().user.count({ where: { role: "ADMIN" } }) === 0;
}
