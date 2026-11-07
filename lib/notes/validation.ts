import { z } from "zod";

export const noteIdSchema = z.string().trim().min(1).max(191);
export const noteTargetSchema = z.object({
  type: z.enum(["event", "eventSeries", "venue", "booking", "ticket", "trainer", "cancellationRequest"]),
  id: noteIdSchema,
}).strict();
export const noteContentSchema = z.object({
  body: z.string().trim().min(1, "Bitte gib einen Notiztext ein."),
  visibility: z.enum(["COMPANY", "PRIVATE"]).default("COMPANY"),
}).strict();
export type NoteTarget = z.infer<typeof noteTargetSchema>;
