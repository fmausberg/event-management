import { cancellationMinutes } from "@/lib/cancellations/policy";
import { parseBerlinDateTime } from "./berlin-date-time";

export interface EventFormValues {
  freeCancellationUntilMinutesBeforeStart?: string;
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
  freeCancellationUntilMinutesBeforeStart?: number | null;
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
  return { ...(formData.has("freeCancellationUntilMinutesBeforeStart") ? { freeCancellationUntilMinutesBeforeStart: text("freeCancellationUntilMinutesBeforeStart") } : {}), name: text("name"), beginsAt: text("beginsAt"), endsAt: text("endsAt"), maxSeats: text("maxSeats") };
}

export function validateEvent(
  values: EventFormValues,
  original?: { beginsAt: Date | null; endsAt: Date | null },
): { success: true; data: EventInput } | { success: false; errors: EventFieldErrors } {
  const errors: EventFieldErrors = {};
  const cancellation = cancellationMinutes.safeParse(values.freeCancellationUntilMinutesBeforeStart);
  if (!cancellation.success) errors.freeCancellationUntilMinutesBeforeStart = cancellation.error.issues[0].message;
  const name = values.name.trim();
  if (!name) errors.name = "Bitte einen Namen eingeben.";

  let beginsAt: Date | undefined;
  let endsAt: Date | undefined;
  try { beginsAt = parseBerlinDateTime(values.beginsAt, original?.beginsAt ?? undefined); }
  catch (error) { errors.beginsAt = (error as Error).message; }
  try { endsAt = parseBerlinDateTime(values.endsAt, original?.endsAt ?? undefined); }
  catch (error) { errors.endsAt = (error as Error).message; }
  if (beginsAt && endsAt && endsAt <= beginsAt) {
    errors.endsAt = "Das Ende muss nach dem Beginn liegen.";
  }

  const maxSeats = Number(values.maxSeats);
  if (!/^\d+$/.test(values.maxSeats.trim()) || !Number.isInteger(maxSeats) || maxSeats <= 0 || maxSeats > 2_147_483_647) {
    errors.maxSeats = "Bitte eine ganze Zahl zwischen 1 und 2147483647 eingeben.";
  }
  if (Object.keys(errors).length || !beginsAt || !endsAt) return { success: false, errors };
  return { success: true, data: { name, beginsAt, endsAt, maxSeats, ...(values.freeCancellationUntilMinutesBeforeStart !== undefined && cancellation.success ? { freeCancellationUntilMinutesBeforeStart: cancellation.data } : {}) } };
}
