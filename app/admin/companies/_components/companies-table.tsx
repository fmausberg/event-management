"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteCompany } from "../actions";
import type { CompanyFormState, CompanyRow } from "@/lib/companies/validation";
import { CompanyForm } from "./company-form";

function DeleteCompany({ company, onDeleted, disabled }: { company: CompanyRow; onDeleted: (message: string) => void; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(async (previous, data) => {
    const result = await deleteCompany(company.id, previous, data);
    if (result.success) onDeleted(result.message!);
    return result;
  }, {});
  const hasRelations = Object.values(company._count).some((count) => count > 0);
  return <div className="max-w-xs">
    {confirming ? <form action={action} className="space-y-2">
      <p className="font-medium">„{company.name}“ endgültig löschen?</p>
      <input type="hidden" name="confirmed" value="yes" />
      <div className="flex gap-3"><button disabled={pending || disabled} className="text-red-700 underline disabled:opacity-50 dark:text-red-400">{pending ? "Wird gelöscht …" : "Ja, löschen"}</button><button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline">Abbrechen</button></div>
    </form> : <button type="button" onClick={() => setConfirming(true)} disabled={disabled || hasRelations} title={hasRelations ? "Company hat noch verknüpfte Datensätze." : undefined} aria-label={`${company.name} löschen`} className="text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400">Löschen</button>}
    {state.message && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{state.message}</p>}
  </div>;
}

export function CompaniesTable({ companies }: { companies: CompanyRow[] }) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ company?: CompanyRow } | null>(null);
  const [message, setMessage] = useState("");
  const search = query.trim().toLocaleLowerCase("de-DE");
  const visible = companies.filter((company) => `${company.name} ${company.slug} ${company.number}`.toLocaleLowerCase("de-DE").includes(search));
  function saved(result: string) { setEditor(null); setMessage(result); }

  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Companies</h1><p className="mt-1 text-sm text-zinc-500">Alle Companies zentral verwalten.</p></div>
      <button type="button" disabled={editor !== null} onClick={() => { setMessage(""); setEditor({}); }} className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">+ Company erstellen</button>
    </div>
    {message && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">{message}</p>}
    {editor && <CompanyForm key={editor.company?.id ?? "new"} company={editor.company} onSaved={saved} onCancel={() => setEditor(null)} />}
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div><label htmlFor="company-search" className="sr-only">Companies nach Name, URL-Kürzel oder Nummer suchen</label><input id="company-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Companies durchsuchen …" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 sm:w-80 dark:border-zinc-700" /></div>
        <p aria-live="polite" className="text-sm text-zinc-500">{visible.length} von {companies.length} Companies</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Companies mit verknüpften Datensätzen und Verwaltungsaktionen</caption>
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
          <tr>
            {["Nr.", "Company", "Mitglieder", "Venues", "Event-Series", "Events", "Aktionen"].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}
          </tr>
        </thead>
        <tbody>{visible.map((company) => <tr key={company.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
          <td className="px-4 py-4 text-zinc-500">{company.number}</td>
          <th scope="row" className="min-w-48 px-4 py-4 font-medium"><span className="block">{company.name}</span><Link href={`/events/${encodeURIComponent(company.slug)}`} className="mt-1 block text-xs font-normal text-primary-700 hover:underline dark:text-primary-300">{company.slug}</Link></th>
          <td className="px-4 py-4"><Link href={`/company/${encodeURIComponent(company.slug)}/members`} aria-label={`Mitglieder von ${company.name} verwalten`} className="text-primary-700 underline dark:text-primary-300">{company._count.memberships}</Link></td><td className="px-4 py-4">{company._count.venues}</td><td className="px-4 py-4">{company._count.eventSeries}</td><td className="px-4 py-4"><Link href={`/company/${encodeURIComponent(company.slug)}/events`} className="text-primary-700 underline dark:text-primary-300" aria-label={`Events von ${company.name} verwalten`}>{company._count.events}</Link></td>
          <td className="px-4 py-4"><div className="flex flex-wrap gap-x-4 gap-y-2"><button type="button" disabled={editor !== null} aria-label={`${company.name} bearbeiten`} onClick={() => { setMessage(""); setEditor({ company }); }} className="text-primary-700 underline disabled:opacity-40 dark:text-primary-300">Bearbeiten</button><DeleteCompany company={company} onDeleted={setMessage} disabled={editor !== null} /></div></td>
        </tr>)}</tbody>
      </table></div>
      {visible.length === 0 && <p className="p-8 text-center text-sm text-zinc-500">{companies.length === 0 ? "Noch keine Companies vorhanden. Erstelle die erste Company über den Button oben." : "Keine Companies zu deiner Suche gefunden."}</p>}
    </div>
    <p className="text-xs text-zinc-500">Löschen ist nur möglich, wenn keine Mitglieder, Venues, Event-Series oder Events mehr zugeordnet sind.</p>
  </main>;
}
