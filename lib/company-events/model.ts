import { z } from "zod";
import type { SeriesRow } from "@/lib/event-series/validation";
const optional = z.string().trim().max(20000).transform((v) => v || null);
export const eventSchema = z.object({
 name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(160),
 shortdescription: optional, description: optional, trainerIds: z.array(z.string().trim().min(1).max(191)).max(50).transform((ids) => [...new Set(ids)]),
 eventSeriesId: z.string().max(191).transform((v) => v || null), venueId: z.string().max(191).transform((v) => v || null),
 beginsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
 maxSeats: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(2147483647)),
 ticketPrice: z.string().trim().transform((v) => v.replace(",", ".")).pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "Bitte gib einen Preis ab 0 mit maximal zwei Nachkommastellen ein.")),
 currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
 status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"]),
}).refine((v) => new Date(v.endsAt) > new Date(v.beginsAt), { path: ["endsAt"], message: "Das Ende muss nach dem Beginn liegen." });
export type EventValues = z.input<typeof eventSchema>;
export type EventState = { success?: boolean; message?: string; errors?: Partial<Record<keyof EventValues, string[]>> };
export type EventRow = Omit<EventValues, "maxSeats"> & { id: string; number: number; trainerName?: string | null; maxSeats: number; remainingSeats: number; _count: { bookings: number; platformEvents: number } };
export const emptyEvent: EventValues = { name: "", shortdescription: "", description: "", trainerIds: [], eventSeriesId: "", venueId: "", beginsAt: "", endsAt: "", maxSeats: "", ticketPrice: "", currency: "EUR", status: "DRAFT" };
export function applySeries(values: EventValues, series: SeriesRow): EventValues {
 return { ...values, eventSeriesId: series.id, name: series.name, shortdescription: series.shortdescription ?? "", description: series.description ?? "", trainerIds: series.suggestedTrainerId ? [series.suggestedTrainerId] : [], venueId: series.suggestedVenueId ?? "", maxSeats: series.suggestedMaxSeats?.toString() ?? "", ticketPrice: series.suggestedTicketPrice ?? "", currency: series.suggestedCurrency };
}
export function localDateTime(iso: string) {
 const date = new Date(iso);
 const pad = (n: number) => String(n).padStart(2, "0");
 return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
