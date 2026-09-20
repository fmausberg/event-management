"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEvent } from "@/lib/events/get-event";
import { insertEvent, saveEventChanges, removeEvent, eventMutationErrorMessage } from "@/lib/events/event-mutations";
import { readEventFormData, validateEvent, type EventFormState } from "@/lib/events/validate-event";

export async function createEvent(_previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const values = readEventFormData(formData);
  const result = validateEvent(values);
  if (!result.success) return { values, errors: result.errors, message: "Bitte korrigiere die markierten Felder." };
  try { await insertEvent(result.data); }
  catch (error) { return { values, message: eventMutationErrorMessage(error) }; }
  revalidatePath("/events");
  redirect("/events");
}

export async function updateEvent(id: string, _previous: EventFormState, formData: FormData): Promise<EventFormState> {
  const values = readEventFormData(formData);
  try {
    const original = await getEvent(id);
    if (!original) return { values, message: "Dieses Event existiert nicht mehr." };
    const result = validateEvent(values, original);
    if (!result.success) return { values, errors: result.errors, message: "Bitte korrigiere die markierten Felder." };
    await saveEventChanges(id, result.data);
  } catch (error) {
    return { values, message: eventMutationErrorMessage(error) };
  }
  revalidatePath("/events");
  revalidatePath("/events/[id]/edit", "page");
  redirect("/events");
}

export async function deleteEvent(id: string, _previous: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  if (formData.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };
  try { await removeEvent(id); }
  catch (error) { return { message: eventMutationErrorMessage(error) }; }
  revalidatePath("/events");
  revalidatePath("/events/[id]/edit", "page");
  return {};
}
