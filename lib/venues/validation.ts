import { z } from "zod";
const text = (max: number) => z.string().trim().max(max, `Bitte h?chstens ${max} Zeichen eingeben.`).transform((value) => value || null);
export const venueSchema = z.object({
 name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(160),
 addressLine1: text(250), addressLine2: text(250), postalCode: text(32), city: text(160),
 countryCode: z.string().trim().toUpperCase().refine((value) => !value || /^[A-Z]{2}$/.test(value), "Bitte gib einen zweistelligen L?ndercode ein, z. B. DE.").transform((value) => value || null),
});
export type VenueValues = z.input<typeof venueSchema>;
export type VenueState = { success?: boolean; message?: string; errors?: Partial<Record<keyof VenueValues, string[]>> };
export type VenueRow = z.output<typeof venueSchema> & { id: string; number: number; _count: { events: number; suggestedForSeries: number } };
