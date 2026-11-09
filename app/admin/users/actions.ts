"use server";

import { revalidatePath } from "next/cache";
import { withSessionAudit } from "@/lib/audit/session";
import { AdminAccessError, requireAdmin } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";

export type UserRoleFormState = { success?: boolean; message?: string };

export async function changeUserRole(userId: string, _previous: UserRoleFormState, data: FormData): Promise<UserRoleFormState> {
  return withSessionAudit("admin/users.changeUserRole", async () => {
    try {
      await requireAdmin();
      const role = data.get("role");
      if (typeof userId !== "string" || !userId.trim() || userId.length > 191 || (role !== "USER" && role !== "ADMIN")) {
        return { message: "Bitte wähle einen gültigen User und eine gültige Rolle." };
      }
      const result = await getPrisma().user.updateMany({ where: { id: userId }, data: { role } });
      if (!result.count) return { message: "Dieser User existiert nicht mehr." };
    } catch (error) {
      if (error instanceof AdminAccessError) return { message: error.message };
      return { message: "Die Rolle konnte nicht gespeichert werden. Bitte versuche es erneut." };
    }
    revalidatePath("/admin/users");
    revalidatePath("/", "layout");
    return { success: true, message: "Rolle wurde gespeichert." };
  });
}
