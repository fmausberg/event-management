import { z } from "zod";
import { emailSchema } from "@/lib/auth/validation";
export const bookingSchema = z.object({
 customerName: z.string().trim().max(160).transform((v) => v || null),
 customerEmail: z.string().trim().transform((v) => v.toLowerCase()).pipe(z.union([z.literal(""), emailSchema])).transform((v) => v || null),
 quantity: z.string().regex(/^\d+$/, "Bitte gib eine ganze Anzahl ein.").transform(Number).pipe(z.number().int().min(1).max(2147483647)),
 status: z.enum(["CONFIRMED", "CANCELLED"]),
});
export type BookingState = { success?: boolean; message?: string };
export type BookingRow = { id: string; number: number; customerName: string | null; customerEmail: string | null; quantity: number; status: "CONFIRMED" | "CANCELLED"; bookedAt: string; platform: string | null; externalBookingId: string | null };
