import Link from "next/link";
import { auditActionLabels, type AuditFilters } from "@/lib/audit/filters";
import { auditModelLabels } from "@/lib/audit/policy";

const inputClass = "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";

function MultiFilter({ label, name, options, selected }: { label: string; name: string; options: { value: string; label: string }[]; selected: string[] }) {
  return <div className="min-w-0"><span className="mb-1 block text-sm text-zinc-500">{label}</span><details className="relative">
    <summary className={`${inputClass} cursor-pointer`}>{selected.length ? `${selected.length} ausgewählt` : "Alle"}</summary>
    <fieldset className="absolute left-0 right-0 z-30 mt-1 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"><legend className="sr-only">{label}: Mehrfachauswahl</legend>
      {options.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"><input className="mt-1 shrink-0" type="checkbox" name={name} value={option.value} defaultChecked={selected.includes(option.value)} /><span className="break-words">{option.label}</span></label>)}
      {!options.length && <p className="p-2 text-sm text-zinc-500">Noch keine Einträge.</p>}
    </fieldset>
  </details></div>;
}

export function AuditFilterForm({ filters, actors }: { filters: AuditFilters; actors: { value: string; label: string }[] }) {
  return <form action="/admin/audit" method="get" className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MultiFilter label="Wer?" name="actor" options={actors} selected={filters.actors} />
      <MultiFilter label="Was?" name="action" options={Object.entries(auditActionLabels).map(([value, label]) => ({ value, label }))} selected={filters.actions} />
      <MultiFilter label="Zielobjekttyp" name="model" options={Object.entries(auditModelLabels).map(([value, label]) => ({ value, label }))} selected={filters.models} />
      <label className="text-sm"><span className="mb-1 block text-zinc-500">Von (Berlin)</span><input aria-label="Zeitraum von, Europe/Berlin" className={inputClass} type="datetime-local" name="from" defaultValue={filters.from} /></label>
      <label className="text-sm"><span className="mb-1 block text-zinc-500">Bis (Berlin)</span><input aria-label="Zeitraum bis, Europe/Berlin" className={inputClass} type="datetime-local" name="to" defaultValue={filters.to} /></label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-4"><button className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">Filter anwenden</button><Link href="/admin/audit" className="text-sm underline">Zurücksetzen</Link><p className="text-xs text-zinc-500">Mehrfachauswahl möglich. Leere Auswahl = alle. Zeitangaben in Europe/Berlin; die Bis-Minute ist eingeschlossen.</p></div>
  </form>;
}
