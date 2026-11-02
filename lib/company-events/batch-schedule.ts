import { formatBerlinDateTime, parseBerlinDateTime } from "@/lib/events/berlin-date-time";

export const MAX_BATCH_EVENTS = 100;
export const MAX_BATCH_RANGE_DAYS = 366;
export type BatchSelection = { dates: string[]; startTime: string; endTime: string; endDayOffset: string; timeMode: "clock" | "duration"; duration: string };
export type BatchOccurrence = { date: string; beginsAt: string; endsAt: string };

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function calendarRange(from: string, to: string): string[] {
  if (!validCalendarDate(from) || !validCalendarDate(to) || from > to) return [];
  const count = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (count > MAX_BATCH_RANGE_DAYS) return [];
  return Array.from({ length: count }, (_, index) => addCalendarDays(from, index));
}
export function berlinCalendarDate(value: Date) { return formatBerlinDateTime(value).slice(0, 10); }

/** Shared by the preview and the server. No browser/server-local timezone conversion. */
export function batchOccurrence(date: string, selection: Omit<BatchSelection, "dates">): BatchOccurrence {
  if (!validCalendarDate(date)) throw new Error("Bitte ein gültiges Datum auswählen.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(selection.startTime)) throw new Error("Bitte die gemeinsame Startuhrzeit angeben.");
  const beginsAt = parseBerlinDateTime(`${date}T${selection.startTime}`);
  let endsAt: Date | null = null;
  if (selection.timeMode === "duration") {
    if (!/^\d+$/.test(selection.duration) || Number(selection.duration) < 1 || Number(selection.duration) > 2147483647) throw new Error("Bitte eine gültige Dauer in Minuten angeben.");
    endsAt = new Date(beginsAt.getTime() + Number(selection.duration) * 60000);
    if (!Number.isFinite(endsAt.getTime()) || endsAt.getUTCFullYear() > 9999) throw new Error("Die Dauer ist zu groß.");
  } else if (selection.timeMode === "clock") {
    if (!/^\d+$/.test(selection.endDayOffset) || Number(selection.endDayOffset) > 366) throw new Error("Bitte einen gültigen Endtag angeben.");
    if (selection.endTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(selection.endTime)) throw new Error("Bitte eine gültige Enduhrzeit angeben.");
      endsAt = parseBerlinDateTime(`${addCalendarDays(date, Number(selection.endDayOffset))}T${selection.endTime}`);
    }
  } else throw new Error("Ungültige Zeitvorgabe.");
  if (endsAt && endsAt <= beginsAt) throw new Error("Das Ende muss nach dem Beginn liegen. Für Termine über Mitternacht den Endtag anpassen.");
  return { date, beginsAt: beginsAt.toISOString(), endsAt: endsAt?.toISOString() ?? "" };
}

export function parseBatchSchedule(form: FormData): { occurrences: BatchOccurrence[]; dateErrors?: Record<string, string>; message?: string } {
  const dates = form.getAll("batchDate");
  if (!dates.length || dates.length > MAX_BATCH_EVENTS || !dates.every(validCalendarDate)) return { occurrences: [], message: `Bitte 1 bis ${MAX_BATCH_EVENTS} gültige Termine auswählen.` };
  if (new Set(dates).size !== dates.length) return { occurrences: [], message: "Ein Datum darf nur einmal ausgewählt werden." };
  const selection = { startTime: String(form.get("batchStartTime") ?? ""), endTime: String(form.get("batchEndTime") ?? ""),
    endDayOffset: String(form.get("batchEndDayOffset") ?? "0"), duration: String(form.get("batchDuration") ?? ""), timeMode: String(form.get("batchTimeMode") ?? "clock") as BatchSelection["timeMode"] };
  const dateErrors: Record<string, string> = {};
  const occurrences: BatchOccurrence[] = [];
  for (const date of [...dates].sort()) {
    try { occurrences.push(batchOccurrence(date, selection)); }
    catch (error) { dateErrors[date] = error instanceof Error ? error.message : "Ungültiger Termin."; }
  }
  return Object.keys(dateErrors).length ? { occurrences: [], dateErrors, message: "Bitte die markierten Termine oder Uhrzeiten korrigieren." } : { occurrences };
}
