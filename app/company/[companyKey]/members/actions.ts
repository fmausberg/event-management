"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "@/lib/auth/validation";
import { findUserByEmail } from "@/lib/auth/users";
import { MemberAccessError, requireCompanyAdmin } from "@/lib/companies/members";

export type MemberFormState = { success?: boolean; message?: string };

export async function removeCompanyMember(companySlug: string, membershipId: string, _previous: MemberFormState, data: FormData): Promise<MemberFormState> {
  try {
    const company = await requireCompanyAdmin(companySlug);
    if (typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191) return { message: "Eine gültige Mitgliedschaft ist erforderlich." };
    if (data.get("confirmed") !== "yes") return { message: "Bitte bestätige das Entfernen der Mitgliedschaft." };
    const result = await getPrisma().companyMembership.deleteMany({ where: { id: membershipId, companyId: company.id } });
    if (!result.count) return { message: "Dieses Mitglied gehört nicht zu dieser Company oder wurde bereits entfernt." };
  } catch (error) {
    if (error instanceof MemberAccessError) return { message: error.message };
    return { message: "Die Mitgliedschaft konnte nicht entfernt werden. Bitte versuche es erneut." };
  }
  revalidatePath(`/company/${encodeURIComponent(companySlug)}/members`);
  revalidatePath("/admin/companies");
  revalidatePath("/", "layout");
  return { success: true, message: "Mitgliedschaft wurde entfernt." };
}

export async function changeMemberRole(companySlug: string, membershipId: string, _previous: MemberFormState, data: FormData): Promise<MemberFormState> {
  try {
    const company = await requireCompanyAdmin(companySlug);
    const role = data.get("role");
    if (typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191 || (role !== "COMPANY_USER" && role !== "COMPANY_ADMIN")) {
      return { message: "Bitte wähle eine gültige Mitgliedschaft und Rolle." };
    }
    const result = await getPrisma().companyMembership.updateMany({
      where: { id: membershipId, companyId: company.id }, data: { role },
    });
    if (!result.count) return { message: "Dieses Mitglied gehört nicht zu dieser Company oder existiert nicht mehr." };
  } catch (error) {
    if (error instanceof MemberAccessError) return { message: error.message };
    return { message: "Die Rolle konnte nicht gespeichert werden. Bitte versuche es erneut." };
  }
  revalidatePath(`/company/${encodeURIComponent(companySlug)}/members`);
  revalidatePath("/", "layout");
  return { success: true, message: "Rolle wurde gespeichert." };
}

export async function addCompanyMember(companySlug: string, _previous: MemberFormState, data: FormData): Promise<MemberFormState> {
  try {
    const company = await requireCompanyAdmin(companySlug);
    const companyId = company.id;
    const parsed = emailSchema.safeParse(data.get("email"));
    if (!parsed.success) return { message: parsed.error.issues[0].message };
    const email = parsed.data;
    const db = getPrisma();
    const user = await findUserByEmail(email);
    const duplicate = await db.companyMembership.findFirst({
      where: { companyId, OR: [{ email }, ...(user ? [{ userId: user.id }] : [])] }, select: { id: true },
    });
    if (duplicate) return { message: "Diese E-Mail-Adresse ist dieser Company bereits zugeordnet." };
    await db.companyMembership.create({ data: {
      companyId, email, userId: user?.id ?? null, role: "COMPANY_USER", status: "ACTIVE",
    } });
  } catch (error) {
    if (error instanceof MemberAccessError) return { message: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { message: "Diese E-Mail-Adresse ist dieser Company bereits zugeordnet." };
    return { message: "Das Mitglied konnte nicht hinzugefügt werden. Bitte versuche es erneut." };
  }
  revalidatePath(`/company/${encodeURIComponent(companySlug)}/members`);
  revalidatePath("/admin/companies");
  revalidatePath("/", "layout");
  return { success: true, message: "Mitglied wurde hinzugefügt." };
}
