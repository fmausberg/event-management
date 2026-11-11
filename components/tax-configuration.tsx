import { requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { resolveEventTax, TaxError } from "@/lib/taxes/service";
import { TaxConfigurationForm } from "./tax-configuration-form";
export async function TaxConfiguration({ slug, kind, id, collapsible = false }: { slug: string; kind: "country" | "event" | "series"; id?: string; collapsible?: boolean }) {
 const { company, canManageMembers } = await requireCompanyAccess(slug);
 if (!canManageMembers) return null;
 const db = getPrisma();
 let content;
 if (kind === "country") {
  const rules = await db.companyTaxRule.findMany({ where: { companyId: company.id }, orderBy: { countryCode: "asc" } });
  content = <>{!rules.length && <p>Noch keine Länderregeln hinterlegt.</p>}{rules.map(rule => <TaxConfigurationForm key={rule.id} slug={slug} kind={kind} countryCode={rule.countryCode} rate={rule.rate.toString()} />)}<TaxConfigurationForm slug={slug} kind={kind} /></>;
 } else {
  const record = kind === "event" ? await db.event.findFirst({ where: { id, companyId: company.id }, select: { taxRateOverride: true } }) : await db.eventSeries.findFirst({ where: { id, companyId: company.id }, select: { taxRateOverride: true } });
  if (!record) return null;
  let effective = "Automatisch je Event-Venue. Nur Termine ohne eigenen Override erben den Reihen-Override; Änderungen gelten für zukünftige Buchungen. Bestehende Buchungssnapshots bleiben erhalten.";
  if (kind === "event") {
   try { const tax = await resolveEventTax(db, id!); effective = `Effektiv: ${tax.rate.toString()} % · ${tax.countryCode} · ${tax.source}`; }
   catch (error) { if (!(error instanceof TaxError)) throw error; effective = error.message; }
  }
  content = <TaxConfigurationForm slug={slug} kind={kind} id={id} rate={record.taxRateOverride?.toString()} effective={effective} />;
 }
 const body = <><p className="text-sm text-zinc-500">Brutto-Endkundenpreise inklusive Steuer. Ohne gültige Regel ist keine Veröffentlichung oder Buchung möglich. Entwürfe können gespeichert werden.</p>{content}</>;
 if (collapsible) return <details className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
  <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Steuersätze</summary>
  <div className="space-y-4 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">{body}</div>
 </details>;
 return <section className="max-w-2xl space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"><h2 className="text-xl font-semibold">Steuersätze</h2>{body}</section>;
}
