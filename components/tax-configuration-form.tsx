"use client";
import { UnsavedChangesForm } from "@/components/unsaved-changes";
import { useActionState } from "react";
import { saveTaxConfiguration, type TaxState } from "@/lib/taxes/actions";
import { countries } from "@/lib/taxes/countries";
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";
export function TaxConfigurationForm({ slug, kind, id = "", countryCode, rate, effective }: {
 slug: string; kind: "country" | "event" | "series"; id?: string; countryCode?: string; rate?: string | null; effective?: string;
}) {
 const [state, action, pending] = useActionState<TaxState, FormData>(saveTaxConfiguration.bind(null, slug, kind, id), {});
 return <UnsavedChangesForm saveState={state} action={action} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
  {effective && <p className="text-sm">{effective}</p>}
  <fieldset disabled={pending} className="flex flex-wrap items-end gap-3">
   {kind === "country" ? <label className="min-w-48 flex-1">Land{countryCode ? <><input type="hidden" name="countryCode" value={countryCode} /><span className="block py-2">{countries.find(c => c.code === countryCode)?.name} ({countryCode})</span></> : <select name="countryCode" required className={input} defaultValue=""><option value="" disabled>Land auswählen</option>{countries.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select>}</label> :
    <label className="flex-1">Steuer-Modus<select name="mode" defaultValue={rate == null ? "automatic" : "override"} className={input}><option value="automatic">Automatisch nach Venue/Veranstaltungsreihe</option><option value="override">Expliziter Steuersatz</option></select></label>}
   <label>Steuersatz (%)<input name="rate" type="text" inputMode="decimal" defaultValue={rate ?? ""} maxLength={8} className={input} placeholder="z. B. 19 oder 0" /></label>
   <button name="intent" value={countryCode ? "update" : "add"} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">Speichern</button>
   {countryCode && <button name="intent" value="remove" className="px-3 py-2 text-sm text-red-700 underline">Entfernen</button>}
  </fieldset>
  {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "text-sm" : "text-sm text-red-700"}>{state.message}</p>}
 </UnsavedChangesForm>;
}
