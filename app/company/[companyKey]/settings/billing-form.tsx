"use client";

import { useActionState } from "react";
import { UnsavedChangesForm } from "@/components/unsaved-changes";
import { countries } from "@/lib/taxes/countries";
import { type CompanyBillingState, type CompanyBillingValues } from "@/lib/companies/billing";
import { saveCompanyBilling } from "./actions";

const fields = [
  { name: "legalName", label: "Rechtlicher Firmenname / vollständiger Name", max: 200, autoComplete: "organization" },
  { name: "addressLine1", label: "Straße und Hausnummer", max: 200, autoComplete: "address-line1" },
  { name: "addressLine2", label: "Adresszusatz", max: 200, autoComplete: "address-line2" },
  { name: "postalCode", label: "Postleitzahl", max: 20, autoComplete: "postal-code" },
  { name: "city", label: "Ort", max: 100, autoComplete: "address-level2" },
  { name: "countryCode", label: "Land" },
  { name: "taxNumber", label: "Steuernummer", max: 100 },
  { name: "vatId", label: "Umsatzsteuer-ID (USt-ID)", max: 50 },
  { name: "billingEmail", label: "Kontakt-E-Mail für Rechnungen", max: 254, autoComplete: "email" },
] as const;

export function CompanyBillingForm({ companyKey, billing }: {
  companyKey: string;
  billing: { [Key in keyof CompanyBillingValues]: CompanyBillingValues[Key] | null };
}) {
  const [state, action, pending] = useActionState<CompanyBillingState, FormData>(saveCompanyBilling.bind(null, companyKey), {});
  const inputClass = "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700 dark:bg-zinc-950";
  return <section aria-labelledby="billing-title" className="max-w-2xl space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 id="billing-title" className="text-xl font-semibold">Rechnungsstammdaten</h2>
    <p className="text-sm text-zinc-500">Diese Angaben werden für zukünftige Rechnungen im Namen deiner Company benötigt. Trage den vollständigen rechtlichen Namen und die Geschäftsadresse ein. Du kannst die Angaben schrittweise ergänzen.</p>
    <UnsavedChangesForm action={action} saveState={state} className="space-y-4">
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
        <legend className="sr-only">Firmendaten und Rechnungsadresse</legend>
        {fields.map(field => {
          const id = `billing-${field.name}`;
          const errors = state.errors?.[field.name];
          const value = state.values?.[field.name] ?? billing[field.name] ?? "";
          return <div key={field.name} className={field.name === "legalName" || field.name === "addressLine1" || field.name === "addressLine2" || field.name === "billingEmail" ? "sm:col-span-2" : undefined}>
            <label htmlFor={id} className="text-sm font-medium">{field.label}</label>
            {field.name === "countryCode" ? <select id={id} name={field.name} defaultValue={value} autoComplete="country" className={inputClass} aria-invalid={!!errors} aria-describedby={errors ? `${id}-error` : undefined}>
              <option value="">Bitte auswählen</option>
              {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select> : <input id={id} name={field.name} type={field.name === "billingEmail" ? "email" : "text"} defaultValue={value} maxLength={field.max} autoComplete={"autoComplete" in field ? field.autoComplete : "off"} className={inputClass} aria-invalid={!!errors} aria-describedby={errors ? `${id}-error` : undefined} />}
            {errors && <p id={`${id}-error`} className="mt-2 text-sm text-red-700 dark:text-red-400">{errors.join(" ")}</p>}
            {field.name === "legalName" && <div className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="isSmallBusiness" defaultChecked={state.values?.isSmallBusiness ?? billing.isSmallBusiness ?? false} aria-describedby="billing-small-business-hint" className="h-4 w-4 rounded border-zinc-300 accent-primary-600" />
                Kleinunternehmer? (§ 19 UStG, Deutschland)
              </label>
              <p id="billing-small-business-hint" className="text-sm text-zinc-500">Aktivieren, wenn deine Company die deutsche Kleinunternehmerregelung anwendet. Für neue Buchungen von Events in Deutschland wird keine Umsatzsteuer berechnet; dies hat Vorrang vor Länder-, Reihen- und Event-Steuersätzen. Der Ticket-Endpreis bleibt gleich. Für andere Länder gelten weiterhin die hinterlegten Steuerregeln. Bestehende Buchungen bleiben unverändert.</p>
            </div>}
          </div>;
        })}
      </fieldset>
      {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-red-700 dark:text-red-400"}>{state.message}</p>}
      <button disabled={pending} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{pending ? "Wird gespeichert …" : "Stammdaten speichern"}</button>
    </UnsavedChangesForm>
  </section>;
}
