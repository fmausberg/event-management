"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { trainerSchema, type TrainerOption, type TrainerState } from "@/lib/trainers/validation";

function refresh(slug: string) {
  revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);
  revalidatePath("/admin/trainers");
  revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
  revalidatePath(`/company/${encodeURIComponent(slug)}/event-series`);
  revalidatePath("/events/[companySlug]/[eventId]", "page");
}
function failure(error: unknown): TrainerState {
  if (error instanceof MemberAccessError) return { message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { message: "Ein Trainer mit dieser E-Mail-Adresse existiert bereits in dieser Company.", errors: { email: ["Diese E-Mail-Adresse wird bereits verwendet."] } };
    if (error.code === "P2003") return { message: "Dieser Trainer wird noch verwendet und kann nicht gelöscht werden." };
  }
  return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
}
function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }

export async function saveTrainer(slug: string, id: string | null, _previous: TrainerState, form: FormData): Promise<TrainerState> {
  let trainer: TrainerOption | undefined;
  try {
    const { company } = await requireCompanyAccess(slug);
    if (id !== null && !validId(id)) return { message: "Ungültiger Trainer." };
    const parsed = trainerSchema.safeParse({ firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email") });
    if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };
    if (id === null) trainer = await getPrisma().trainer.create({ data: { ...parsed.data, companyId: company.id }, select: { id: true, firstName: true, lastName: true, email: true } });
    else {
      const result = await getPrisma().trainer.updateMany({ where: { id, companyId: company.id }, data: parsed.data });
      if (!result.count) return { message: "Dieser Trainer existiert nicht in dieser Company." };
    }
  } catch (error) { return failure(error); }
  refresh(slug);
  return { success: true, trainer, message: id === null ? "Trainer wurde erstellt." : "Trainer wurde gespeichert." };
}

export async function deleteTrainer(slug: string, id: string, _previous: TrainerState, form: FormData): Promise<TrainerState> {
  try {
    const { company } = await requireCompanyAccess(slug);
    if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen eines gültigen Trainers." };
    const result = await getPrisma().trainer.deleteMany({ where: { id, companyId: company.id, events: { none: {} }, suggestedForSeries: { none: {} } } });
    if (!result.count) return { message: "Dieser Trainer wird noch von Veranstaltungen oder Veranstaltungsreihen verwendet oder existiert nicht in dieser Company." };
  } catch (error) { return failure(error); }
  refresh(slug);
  return { success: true, message: "Trainer wurde gelöscht." };
}
