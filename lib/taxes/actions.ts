"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireCompanyAdmin, requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { parseTaxRate, TaxError, resolveEventTax, resolveTax } from "./service";
import { isCountryCode } from "./countries";
export type TaxState = { success?: boolean; message?: string };
export async function saveTaxConfiguration(slug: string, kind: "country" | "event" | "series", id: string, _previous: TaxState, form: FormData): Promise<TaxState> {
 try {
  const company = await requireCompanyAdmin(slug);
  const db = getPrisma();
  if (!["country", "event", "series"].includes(kind) || typeof id !== "string" || id.length > 191) throw new TaxError("Ungültige Steuerkonfiguration.");
  await db.$transaction(async tx => {
   if (kind === "country") {
    if (form.getAll("countryCode").length !== 1 || !["add", "update", "remove"].includes(String(form.get("intent")))) throw new TaxError("Bitte eine gueltige Aktion und ein Land auswaehlen.");
    const countryCode = String(form.get("countryCode") ?? "").trim().toUpperCase();
    if (!isCountryCode(countryCode)) throw new TaxError("Bitte ein gültiges Land auswählen.");
    if (form.get("intent") === "remove") {
     await tx.companyTaxRule.deleteMany({ where: { companyId: company.id, countryCode } });
    } else {
     const rate = parseTaxRate(form.get("rate"));
     if (form.get("intent") === "add") await tx.companyTaxRule.create({ data: { companyId: company.id, countryCode, rate } });
     else await tx.companyTaxRule.update({ where: { companyId_countryCode: { companyId: company.id, countryCode } }, data: { rate } });
    }
   } else {
    const taxRateOverride = form.get("mode") === "automatic" ? null : form.get("mode") === "override" ? parseTaxRate(form.get("rate")) : undefined;
    if (taxRateOverride === undefined) throw new TaxError("Bitte einen gültigen Steuer-Modus auswählen.");
    const result = kind === "event" ? await tx.event.updateMany({ where: { id, companyId: company.id }, data: { taxRateOverride } }) :
     await tx.eventSeries.updateMany({ where: { id, companyId: company.id }, data: { taxRateOverride } });
    if (result.count !== 1) throw new TaxError("Diese Veranstaltung oder Reihe gehört nicht zu dieser Company.");
    // Series fallback: only events without their own override inherit dynamically.
    const published = await tx.event.findMany({ where: { companyId: company.id, status: "PUBLISHED", ...(kind === "event" ? { id } : { eventSeriesId: id }) }, select: { id: true } });
    for (const event of published) await resolveEventTax(tx, event.id);
   }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  revalidatePath(`/company/${encodeURIComponent(slug)}`, "layout");
  revalidatePath("/events", "layout");
  return { success: true, message: "Steuerkonfiguration wurde gespeichert." };
 } catch (error) {
  if (error instanceof TaxError || error instanceof MemberAccessError) return { message: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { message: "Für dieses Land besteht bereits eine Steuerregel. Bitte den vorhandenen Eintrag bearbeiten." };
  return { message: "Die Steuerkonfiguration konnte nicht gespeichert werden. Bitte neu laden und erneut versuchen." };
 }
}

export async function loadTaxEditor(slug: string, kind: "event" | "series", id: string | null, venueId: string, seriesId: string) {
 const { company, canManageMembers } = await requireCompanyAccess(slug);
 if (!canManageMembers) return null;
 const db = getPrisma();
 if (!["event", "series"].includes(kind) || [id, venueId, seriesId].some(v => v != null && (typeof v !== "string" || v.length > 191))) throw new TaxError("Ungültige Auswahl.");
 const record = !id ? null : kind === "event" ? await db.event.findFirst({ where: { id, companyId: company.id }, select: { taxRateOverride: true } }) : await db.eventSeries.findFirst({ where: { id, companyId: company.id }, select: { taxRateOverride: true } });
 if (id && !record) throw new TaxError("Diese Veranstaltung oder Reihe ist nicht verfügbar.");
 if (kind === "series") return { rate: record?.taxRateOverride?.toString() ?? null, automatic: "Automatisch je Event-Venue. Ein Reihen-Override gilt nur für Events ohne eigenen Override; bestehende Buchungssnapshots bleiben unverändert." };
 const venue = venueId ? await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { companyId: true, countryCode: true } }) : null;
 const series = seriesId ? await db.eventSeries.findFirst({ where: { id: seriesId, companyId: company.id }, select: { companyId: true, taxRateOverride: true } }) : null;
 if (venueId && !venue || seriesId && !series) throw new TaxError("Ort oder Reihe gehört nicht zu dieser Company.");
 let automatic: string;
 try { const tax = await resolveTax(db, company.id, null, venue, series); automatic = `Automatisch: ${tax.rate.toString()} % · ${tax.countryCode} · ${tax.source}`; }
 catch (error) { if (!(error instanceof TaxError)) throw error; automatic = error.message; }
 return { rate: record?.taxRateOverride?.toString() ?? null, automatic };
}
