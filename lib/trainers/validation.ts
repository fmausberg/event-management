import { z } from "zod";
import { emailSchema } from "@/lib/auth/validation";

const name = z.string().trim().min(1, "Bitte gib einen Namen ein.").max(160, "Bitte höchstens 160 Zeichen eingeben.");
export const trainerSchema = z.object({ firstName: name, lastName: name, email: emailSchema });
export type TrainerValues = z.input<typeof trainerSchema>;
export type TrainerOption = z.output<typeof trainerSchema> & { id: string };
export type TrainerState = { trainer?: TrainerOption; success?: boolean; message?: string; errors?: Partial<Record<keyof TrainerValues, string[]>> };
export type TrainerRow = z.output<typeof trainerSchema> & { id: string; number: number; accountStatus: "missing" | "unverified" | "verified"; _count: { events: number; suggestedForSeries: number } };
