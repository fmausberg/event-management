"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEvent } from "@/lib/events/get-event";
import { saveEventChanges, removeEvent, eventMutationErrorMessage } from "@/lib/events/event-mutations";
import { readEventFormData, validateEvent, type EventFormState } from "@/lib/events/validate-event";

export async function createEvent(_previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const values = readEventFormData(formData);
  const result = validateEvent(values);
  if (!result.success) return { values, errors: result.errors, message: "Bitte korrigiere die markierten Felder." };
  return { values, message: "Bitte erstelle Events in der Eventverwaltung der jeweiligen Company. Dort kannst du Company, Preis und Eventreihe korrekt zuordnen." };
}

export async function updateEvent(id: string, _previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const values = readEventFormData(formData);
  try {
    await requireAdmin();
    const original = await getEvent(id);
    if (!original) return { values, message: "Dieses Event existiert nicht mehr." };
    const result = validateEvent(values, original);
    if (!result.success) return { values, errors: result.errors, message: "Bitte korrigiere die markierten Felder." };
    await saveEventChanges(id, result.data);
  } catch (error) {
    return { values, message: eventMutationErrorMessage(error) };
  }
  revalidatePath("/admin/events");
  revalidatePath("/admin/events/[id]/edit", "page");
  revalidatePath("/account/bookings");
  revalidatePath("/events/[companySlug]/[eventId]", "page");
  revalidatePath("/company/[companyKey]", "layout");
  redirect("/admin/events");
}

export async function deleteEvent(id: string, _previous: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  if (formData.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  try { await removeEvent(id); }
  catch (error) { return { message: eventMutationErrorMessage(error) }; }
  revalidatePath("/admin/events");
  revalidatePath("/admin/events/[id]/edit", "page");
  return {};
}
