import { parseBerlinDateTime } from "./berlin-date-time";

export interface EventFormValues {
  name: string;
  beginsAt: string;
  endsAt: string;
  maxSeats: string;
}

export type EventFieldErrors = Partial<Record<keyof EventFormValues, string>>;
export interface EventFormState {
  values: EventFormValues;
  errors?: EventFieldErrors;
  message?: string;
}
export interface EventInput {
  name: string;
  beginsAt: Date;
  endsAt: Date;
  maxSeats: number;
}

export function readEventFormData(formData: FormData): EventFormValues {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return { name: text("name"), beginsAt: text("beginsAt"), endsAt: text("endsAt"), maxSeats: text("maxSeats") };
}

export function validateEvent(
  values: EventFormValues,
  original?: Pick<EventInput, "beginsAt" | "endsAt">,
): { success: true; data: EventInput } | { success: false; errors: EventFieldErrors } {
  const errors: EventFieldErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "Bitte einen Namen eingeben.";

  let beginsAt: Date | undefined;
  let endsAt: Date | undefined;
  try { beginsAt = parseBerlinDateTime(values.beginsAt, original?.beginsAt); }
  catch (error) { errors.beginsAt = (error as Error).message; }
  try { endsAt = parseBerlinDateTime(values.endsAt, original?.endsAt); }
  catch (error) { errors.endsAt = (error as Error).message; }
  if (beginsAt && endsAt && endsAt <= beginsAt) {
    errors.endsAt = "Das Ende muss nach dem Beginn liegen.";
  }

  const maxSeats = Number(values.maxSeats);
  if (!/^\d+$/.test(values.maxSeats.trim()) || !Number.isInteger(maxSeats) || maxSeats <= 0 || maxSeats > 2_147_483_647) {
    errors.maxSeats = "Bitte eine ganze Zahl zwischen 1 und 2147483647 eingeben.";
  }
  if (Object.keys(errors).length || !beginsAt || !endsAt) return { success: false, errors };
  return { success: true, data: { name, beginsAt, endsAt, maxSeats } };
}
