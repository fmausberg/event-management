import { z } from "zod";
import { parseBerlinDateTime } from "@/lib/events/berlin-date-time";

const optionalText = (max: number) => z.string().trim().max(max).transform(v => v || null);
const limit = z.string().trim().regex(/^$|^[1-9]\d{0,9}$/, "Bitte ein positives ganzzahliges Limit eingeben.")
  .transform(v => v ? Number(v) : null).refine(v => v === null || v <= 2147483647, "Limit zu groß.");
const date = z.string().max(40).transform((v, ctx) => {
  try { return parseBerlinDateTime(v); }
  catch { ctx.addIssue({ code: "custom", message: "Bitte ein gültiges Datum in Europe/Berlin eingeben." }); return z.NEVER; }
});
const optionalDate = z.union([z.literal(""), date]).transform(v => v === "" ? null : v);
const ids = z.array(z.string().min(1).max(191)).max(500).transform(v => [...new Set(v)].sort());
export const campaignInput = z.object({
  name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000),
  kind: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "STORED_VALUE"]), currency: z.literal("EUR"),
  value: z.string().trim().regex(/^\d{1,8}([.,]\d{1,2})?$/, "Wert mit höchstens zwei Nachkommastellen eingeben.")
    .transform(v => { const [whole, fraction = ""] = v.replace(",", ".").split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); }),
  startsAt: date, endsAt: optionalDate, maxRedemptions: limit, maxRedemptionsPerCustomer: limit,
  maxEligibleTicketsPerBooking: limit, source: optionalText(160),
  companyIds: ids, seriesIds: ids, eventIds: ids, venueIds: ids,
}).superRefine((v, ctx) => {
  if (v.value < 1 || v.value > (v.kind === "PERCENTAGE" ? 10000 : 99_999_999)) ctx.addIssue({ code: "custom", message: "Ungültiger Prozent- oder Eurobetrag." });
  if (v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", message: "Das Ende muss nach dem Beginn liegen." });
  if (v.kind === "STORED_VALUE" && v.maxEligibleTicketsPerBooking !== null) ctx.addIssue({ code: "custom", message: "Wertguthaben hat kein Rabatt-Ticketlimit." });
});
export const issueInput = z.object({
  requestId: z.string().uuid(), mode: z.enum(["PUBLIC", "INDIVIDUAL"]),
  count: z.coerce.number().int().min(1).max(100), publicCode: z.string().trim().max(128),
  maxRedemptions: limit, assignedUserId: optionalText(191), source: optionalText(160), expiresAt: optionalDate,
}).superRefine((v, ctx) => {
  if (v.mode === "PUBLIC" && v.count !== 1) ctx.addIssue({ code: "custom", message: "Pro Ausgabevorgang genau einen öffentlichen Code anlegen." });
  if (v.mode === "INDIVIDUAL" && v.publicCode) ctx.addIssue({ code: "custom", message: "Individuelle Codes werden zufällig erzeugt." });
});
export const codeEditInput = z.object({
  source: optionalText(160), status: z.enum(["ACTIVE", "DISABLED", "ARCHIVED"]), newCode: z.string().trim().max(128),
});
export type CampaignInput = z.infer<typeof campaignInput>;
export type VoucherAdminState = { success?: boolean; message?: string; campaignId?: string; codes?: string[]; replay?: boolean };
export type TargetOptions = { companies: { id: string; name: string }[]; series: { id: string; number: number; name: string }[]; events: { id: string; number: number; name: string; beginsAt: Date | null }[]; venues: { id: string; name: string }[] };
