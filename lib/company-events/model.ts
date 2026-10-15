import { z } from "zod";
import type { SeriesRow } from "@/lib/event-series/validation";
const optional = z.string().trim().max(20000).transform((v) => v || null);
export const eventSchema = z.object({
 name: z.string().trim().max(160),
 shortdescription: optional, description: optional, trainerIds: z.array(z.string().trim().min(1).max(191)).max(50).transform((ids) => [...new Set(ids)]),
 eventSeriesId: z.string().max(191).transform((v) => v || null), venueId: z.string().max(191).transform((v) => v || null),
 beginsAt: z.union([z.literal(""), z.iso.datetime({ offset: true })]), endsAt: z.union([z.literal(""), z.iso.datetime({ offset: true })]),
 maxSeats: z.union([z.literal("").transform(() => null), z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(2147483647))]),
 ticketPrice: z.union([z.literal("").transform(() => null), z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Bitte gib einen Preis ab 0 mit maximal zwei Nachkommastellen ein."))]),
 currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
 status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"]),
}).refine((v) => !v.endsAt || !v.beginsAt || new Date(v.endsAt) > new Date(v.beginsAt), { path: ["endsAt"], message: "Das Ende muss nach dem Beginn liegen." });
export const publishEventSchema = eventSchema.superRefine((v, ctx) => {
 for (const key of ["name", "shortdescription", "beginsAt", "endsAt", "ticketPrice", "maxSeats", "venueId"] as const) {
  if (v[key] === null || v[key] === "") ctx.addIssue({ code: "custom", path: [key], message: "Bitte vor der Veröffentlichung ausfüllen." });
 }
});
export type EventValues = z.input<typeof eventSchema>;
export type EventState = { success?: boolean; message?: string; warnings?: string[]; errors?: Partial<Record<keyof EventValues, string[]>> };
export type EventRow = Omit<EventValues, "maxSeats"> & { id: string; number: number; trainerName?: string | null; imageUrl?: string | null; maxSeats: number | null; remainingSeats: number | null; _count: { bookings: number; platformEvents: number } };
export const emptyEvent: EventValues = { name: "", shortdescription: "", description: "", trainerIds: [], eventSeriesId: "", venueId: "", beginsAt: "", endsAt: "", maxSeats: "", ticketPrice: "", currency: "EUR", status: "DRAFT" };
export function applySeries(values: EventValues, series: SeriesRow): EventValues {
 return { ...values, eventSeriesId: series.id, name: series.name, shortdescription: series.shortdescription ?? "", description: series.description ?? "", trainerIds: series.suggestedTrainerId ? [series.suggestedTrainerId] : [], venueId: series.suggestedVenueId ?? "", maxSeats: series.suggestedMaxSeats?.toString() ?? "", ticketPrice: series.suggestedTicketPrice ?? "", currency: "EUR" };
}
export function localDateTime(iso: string) {
 if (!iso) return "";
 const date = new Date(iso);
 const pad = (n: number) => String(n).padStart(2, "0");
 return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
