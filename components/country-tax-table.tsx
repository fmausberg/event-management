"use client";
import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { countries } from "@/lib/taxes/countries";
import { saveTaxConfiguration, type TaxState } from "@/lib/taxes/actions";
import { TaxConfigurationForm } from "./tax-configuration-form";
type CountryTaxRow = { countryCode: string; rate: string; venueCount: number; upcomingCount: number; affectedCount: number };
function CountryRow({ slug, row, onSaved }: { slug: string; row: CountryTaxRow; onSaved: (message: string) => void }) {
 const router = useRouter(), formId = useId();
 const [rate, setRate] = useState(row.rate);
 const [confirmation, setConfirmation] = useState<TaxState["confirmation"]>();
 const [state, action, pending] = useActionState<TaxState, FormData>(async (previous, form) => {
  const result = await saveTaxConfiguration(slug, "country", "", previous, form);
  setConfirmation(result.confirmation);
  if (result.success) { onSaved(result.message ?? "Steuerkonfiguration wurde gespeichert."); router.refresh(); }
  return result;
 }, {});
 const countryName = countries.find(country => country.code === row.countryCode)?.name ?? row.countryCode;
 return <>
  <tr className="border-t border-zinc-200 align-middle dark:border-zinc-800">
   <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium">{countryName} <span className="text-zinc-500">({row.countryCode})</span></th>
   <td className="px-4 py-3"><div className="flex items-center gap-2"><input form={formId} name="rate" aria-label={`Steuersatz für ${countryName} in Prozent`} inputMode="decimal" maxLength={8} value={rate} disabled={pending} onChange={event => { setRate(event.target.value); setConfirmation(undefined); }} className="w-24 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700" /><span>%</span></div></td>
   <td className="px-4 py-3 text-right tabular-nums">{row.venueCount}</td>
   <td className="px-4 py-3 text-right tabular-nums">{row.upcomingCount}</td>
   <td className="px-4 py-3"><form id={formId} action={action} className="flex items-center gap-3">
    <input type="hidden" name="countryCode" value={row.countryCode} />
    {confirmation && <><input type="hidden" name="confirmedRate" value={confirmation.rate} /><input type="hidden" name="confirmedUpcomingCount" value={confirmation.upcomingCount} /><input type="hidden" name="confirmedAffectedCount" value={confirmation.affectedCount} /></>}
    <button name="intent" value="update" disabled={pending} aria-label={confirmation ? `Änderung für ${countryName} bestätigen` : `Steuersatz für ${countryName} speichern`} title={confirmation ? "Änderung bestätigen" : "Speichern"} className="rounded-lg p-2 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></svg></button>
    <button name="intent" value="remove" disabled={pending || row.upcomingCount > 0} aria-label={`Länderregel für ${countryName} löschen`} title={row.upcomingCount ? "Löschen ist erst ohne kommende Events möglich." : "Länderregel löschen"} className="rounded-lg p-2 text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg></button>
   </form></td>
  </tr>
  {(confirmation || state.message && !state.confirmation) && <tr className="border-t border-zinc-200 dark:border-zinc-800"><td colSpan={5} className="px-4 py-3">
   {confirmation ? <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p>Es gibt {confirmation.upcomingCount} kommende Events in {countryName}. Für {confirmation.affectedCount} davon ändert sich der automatisch ermittelte Steuersatz bei neuen Buchungen auf {confirmation.rate} %. Events mit eigenem oder Reihen-Override und bestehende Buchungssnapshots bleiben unverändert.</p>
    <button type="button" disabled={pending} onClick={() => setConfirmation(undefined)} className="underline">Abbrechen</button>
   </div> : <p role={state.success ? "status" : "alert"} className={state.success ? "text-sm text-green-700 dark:text-green-300" : "text-sm text-red-700 dark:text-red-300"}>{state.message}</p>}
  </td></tr>}
 </>;
}
export function CountryTaxTable({ slug, rows }: { slug: string; rows: CountryTaxRow[] }) {
 const [message, setMessage] = useState("");
 return <div className="space-y-4">
  {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
  <div className="max-h-[32rem] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
   <table className="w-full text-left text-sm"><caption className="sr-only">Länderregeln und zugeordnete Venues und kommende Events</caption>
    <thead className="sticky top-0 z-10 bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Land", "Steuersatz", "Venues", "Kommende Events", "Aktionen"].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <CountryRow key={`${row.countryCode}:${row.rate}`} slug={slug} row={row} onSaved={setMessage} />)}</tbody>
   </table>
   {!rows.length && <p className="p-6 text-sm text-zinc-500">Noch keine Länderregeln hinterlegt.</p>}
  </div>
  <p className="text-xs text-zinc-500">Kommende Events: noch nicht gestartete Entwürfe und veröffentlichte Events am tatsächlichen Venue. Abgesagte und abgeschlossene Events zählen nicht. Solange kommende Events bestehen, ist Löschen gesperrt.</p>
  <details className="rounded-lg border border-zinc-200 dark:border-zinc-800"><summary className="cursor-pointer p-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary-600">+ Länderregel hinzufügen</summary><div className="p-3 pt-0"><TaxConfigurationForm slug={slug} kind="country" /></div></details>
 </div>;
}
