"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { AdminAccessError, requireAdmin } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";
import { companySchema, companyIdSchema, readCompanyForm, type CompanyFormState } from "@/lib/companies/validation";

const duplicateSlug = "Dieses URL-Kürzel wird bereits von einer anderen Company verwendet.";
const dependentRecords = "Diese Company hat noch Mitglieder, Venues, Event-Series oder Events und kann deshalb nicht gelöscht werden.";

function mutationError(error: unknown): CompanyFormState {
  if (error instanceof AdminAccessError) return { message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { errors: { slug: [duplicateSlug] }, message: duplicateSlug };
    if (error.code === "P2025") return { message: "Diese Company existiert nicht mehr. Bitte lade die Seite neu." };
    if (error.code === "P2003") return { message: dependentRecords };
  }
  return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}

function refreshCompanies() {
  revalidatePath("/admin/companies");
  // Refresh company names in the shared sidebar as well as public company URLs.
  revalidatePath("/", "layout");
}

async function saveCompany(id: string | null, formData: FormData): Promise<CompanyFormState> {
  const values = readCompanyForm(formData);
  try {
    await requireAdmin();
    if (id !== null && !companyIdSchema.safeParse(id).success) return { values, message: "Eine gültige Company-ID ist erforderlich." };
    const parsed = companySchema.safeParse(values);
    if (!parsed.success) return { values, errors: parsed.error.flatten().fieldErrors, message: "Bitte korrigiere die markierten Felder." };
    const prisma = getPrisma();
    const duplicate = await prisma.company.findFirst({
      where: { slug: { equals: parsed.data.slug, mode: "insensitive" }, ...(id !== null ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (duplicate) return { values, errors: { slug: [duplicateSlug] }, message: duplicateSlug };
    if (id === null) {
      await prisma.company.create({ data: parsed.data, select: { id: true } });
    } else {
      await prisma.company.update({ where: { id }, data: parsed.data, select: { id: true } });
    }
  } catch (error) {
    return { values, ...mutationError(error) };
  }
  refreshCompanies();
  return { success: true, message: id === null ? "Company wurde erstellt." : "Company wurde gespeichert." };
}

export async function createCompany(_previous: CompanyFormState, formData: FormData) {
  return saveCompany(null, formData);
}

export async function updateCompany(id: string, _previous: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  // Never let null/undefined supplied to this action switch to creation mode.
  if (!companyIdSchema.safeParse(id).success) return { message: "Eine gültige Company-ID ist erforderlich." };
  return saveCompany(id, formData);
}

export async function deleteCompany(id: string, _previous: CompanyFormState, formData: FormData): Promise<CompanyFormState> {
  try {
    await requireAdmin();
    if (!companyIdSchema.safeParse(id).success) return { message: "Eine gültige Company-ID ist erforderlich." };
    if (formData.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen der Company." };
    const prisma = getPrisma();
    // One conditional DELETE avoids deleting relations introduced between reads.
    // Restrict foreign keys also protect against concurrent relation inserts.
    const result = await prisma.company.deleteMany({
      where: { id, memberships: { none: {} }, venues: { none: {} }, eventSeries: { none: {} }, events: { none: {} } },
    });
    if (result.count === 0) {
      const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
      return { message: company ? dependentRecords : "Diese Company existiert nicht mehr. Bitte lade die Seite neu." };
    }
  } catch (error) {
    return mutationError(error);
  }
  refreshCompanies();
  return { success: true, message: "Company wurde gelöscht." };
}
