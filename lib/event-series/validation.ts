import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
export const seriesSchema = z.object({
  name: z.string().trim().min(1, "Bitte gib einen Namen ein.").max(160),
  shortdescription: optionalText(500),
  description: optionalText(20000),
  imageUrl: z.string().trim().refine((value) => !value || URL.canParse(value) && ["https:", "http:"].includes(new URL(value).protocol), "Bitte gib eine gültige HTTP(S)-Bild-URL ein.").transform((value) => value || null),
  suggestedMaxSeats: z.string().trim().refine((value) => !value || /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647, "Die Teilnehmerzahl muss eine positive ganze Zahl sein.").transform((value) => value ? Number(value) : null),
  suggestedTicketPrice: z.string().trim().transform((value) => value.replace(",", ".")).refine((value) => !value || /^\d{1,8}(\.\d{1,2})?$/.test(value), "Bitte gib einen Preis ab 0 mit höchstens zwei Nachkommastellen ein.").transform((value) => value || null),
  suggestedCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Bitte gib einen dreistelligen Währungscode ein, z. B. EUR."),
  suggestedTrainerName: optionalText(160),
  suggestedVenueId: optionalText(191),
});
export type SeriesValues = z.input<typeof seriesSchema>;
export type SeriesState = { success?: boolean; message?: string; errors?: Partial<Record<keyof SeriesValues, string[]>> };
export type SeriesRow = { id: string; number: number; name: string; shortdescription: string | null; description: string | null; imageUrl: string | null; suggestedMaxSeats: number | null; suggestedTicketPrice: string | null; suggestedCurrency: string; suggestedTrainerName: string | null; suggestedVenueId: string | null; _count: { events: number } };
export type VenueOption = { id: string; name: string };
