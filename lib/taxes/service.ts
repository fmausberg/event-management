import "server-only";
import { Prisma } from "@prisma/client";
import { isCountryCode } from "./countries";
export class TaxError extends Error {}
export function parseTaxRate(value: unknown): Prisma.Decimal {
  if (typeof value !== "string" || !/^\d{1,3}([.,]\d{1,4})?$/.test(value.trim())) throw new TaxError("Bitte einen Steuersatz von 0 bis 100 mit höchstens vier Nachkommastellen eingeben.");
  const rate = new Prisma.Decimal(value.trim().replace(",", "."));
  if (rate.gt(100)) throw new TaxError("Der Steuersatz muss zwischen 0 und 100 liegen.");
  return rate;
}
export async function resolveEventTax(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { companyId: true, taxRateOverride: true,
    venue: { select: { companyId: true, countryCode: true } }, eventSeries: { select: { companyId: true, taxRateOverride: true } } } });
  return resolveTax(tx, event.companyId, event.taxRateOverride, event.venue, event.eventSeries);
}
export async function resolveTax(tx: Prisma.TransactionClient, companyId: string, override: Prisma.Decimal | null,
 venue: { companyId: string; countryCode: string | null } | null,
 series: { companyId: string; taxRateOverride: Prisma.Decimal | null } | null) {
  if (venue && venue.companyId !== companyId || series && series.companyId !== companyId) throw new TaxError("Ort und Veranstaltungsreihe müssen zur Company gehören.");
  const countryCode = venue?.countryCode?.trim().toUpperCase();
  if (!countryCode || !isCountryCode(countryCode)) throw new TaxError("Für diese Veranstaltung fehlt ein gültiges Venue-Land. Bitte den Veranstalter kontaktieren.");
  if (override !== null) return { countryCode, rate: override, source: "EVENT_OVERRIDE" as const };
  if (series?.taxRateOverride != null) return { countryCode, rate: series.taxRateOverride, source: "SERIES_OVERRIDE" as const };
  const rule = await tx.companyTaxRule.findUnique({ where: { companyId_countryCode: { companyId, countryCode } } });
  if (!rule) throw new TaxError(`Für das Venue-Land ${countryCode} ist noch kein Steuersatz hinterlegt. Bitte den Veranstalter kontaktieren.`);
  return { countryCode, rate: rule.rate, source: "COMPANY_COUNTRY_RULE" as const };
}
export async function bookingTaxSnapshot(tx: Prisma.TransactionClient, eventId: string, grossMinor: number) {
  const tax = await resolveEventTax(tx, eventId);
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) throw new TaxError("Ungültiger Buchungsbetrag.");
  // Decimal ROUND_HALF_UP, once on the total booking gross; never per ticket.
  const taxMinor = new Prisma.Decimal(grossMinor).times(tax.rate).div(tax.rate.plus(100)).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return { taxCountryCode: tax.countryCode, taxRate: tax.rate, taxGrossMinor: grossMinor, taxMinor,
    taxNetMinor: grossMinor - taxMinor, taxSource: tax.source, taxCalculationVersion: 1 };
}

export function taxOverrideFromForm(form: FormData) {
 if (form.getAll("taxMode").length !== 1 || form.getAll("taxRate").length > 1) throw new TaxError("Ungültige Steuerangaben.");
 if (form.get("taxMode") === "automatic") return null;
 if (form.get("taxMode") === "override") return parseTaxRate(form.get("taxRate"));
 throw new TaxError("Ungültiger Steuer-Modus.");
}
