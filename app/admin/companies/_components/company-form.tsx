"use client";

import { useActionState, useState } from "react";
import { createCompany, updateCompany } from "../actions";
import { suggestCompanySlug, type CompanyFormState, type CompanyRow } from "@/lib/companies/validation";

export function CompanyForm({ company, onSaved, onCancel }: {
  company?: CompanyRow;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(company?.name ?? "");
  const [slug, setSlug] = useState(company?.slug ?? "");
  const [customSlug, setCustomSlug] = useState(!!company);
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(async (previous, data) => {
    const result = company ? await updateCompany(company.id, previous, data) : await createCompany(previous, data);
    if (result.success) onSaved(result.message!);
    return result;
  }, {});
  const inputClass = "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-950";
  return <section aria-labelledby="company-form-title" className="rounded-xl border border-violet-200 bg-white p-5 dark:border-violet-900 dark:bg-zinc-900">
    <h2 id="company-form-title" className="text-lg font-semibold">{company ? "Company bearbeiten" : "Company erstellen"}</h2>
    <form action={action} className="mt-4 space-y-4">
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
        <legend className="sr-only">Company-Stammdaten</legend>
        <div><label htmlFor="company-name" className="text-sm font-medium">Name</label>
          <input id="company-name" name="name" value={name} onChange={(event) => { setName(event.target.value); if (!customSlug) setSlug(suggestCompanySlug(event.target.value)); }} required maxLength={160} autoFocus className={inputClass} aria-invalid={!!state.errors?.name} aria-describedby={state.errors?.name ? "company-name-error" : undefined} />
          {state.errors?.name && <p id="company-name-error" className="mt-2 text-sm text-red-700 dark:text-red-400">{state.errors.name.join(" ")}</p>}
        </div>
        <div><label htmlFor="company-slug" className="text-sm font-medium">URL-Kürzel (Slug)</label>
          <input id="company-slug" name="slug" value={slug} onChange={(event) => { setSlug(event.target.value); setCustomSlug(true); }} required maxLength={100} autoCapitalize="none" spellCheck={false} className={inputClass} aria-invalid={!!state.errors?.slug} aria-describedby={`company-slug-hint${state.errors?.slug ? " company-slug-error" : ""}`} />
          <p id="company-slug-hint" className="mt-2 break-all text-xs text-zinc-500">Öffentliche Eventseite: /events/{slug || "url-kuerzel"}</p>
          {state.errors?.slug && <p id="company-slug-error" className="mt-2 text-sm text-red-700 dark:text-red-400">{state.errors.slug.join(" ")}</p>}
        </div>
      </fieldset>
      {company && <p className="text-sm text-zinc-500">Wenn du das URL-Kürzel änderst, ändert sich auch der Link zur öffentlichen Eventseite.</p>}
      {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.message}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">{pending ? "Wird gespeichert …" : company ? "Änderungen speichern" : "Company erstellen"}</button>
        <button type="button" disabled={pending} onClick={onCancel} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Abbrechen</button>
      </div>
    </form>
  </section>;
}
