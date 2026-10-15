"use client";
import { TrainerPicker } from "@/components/trainer-picker";
import type { TrainerOption } from "@/lib/trainers/validation";
import { useActionState, useState } from "react";
import { deleteSeries, saveSeries } from "../actions";
import type { SeriesRow, SeriesState, SeriesValues, VenueOption } from "@/lib/event-series/validation";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";
const primaryClass = "rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const fields: { name: keyof SeriesValues; label: string; type?: string; maxLength?: number; min?: number; max?: number; step?: string }[] = [
  { name: "name", label: "Name", maxLength: 160 },
  { name: "shortdescription", label: "Kurzbeschreibung", maxLength: 500 },
  { name: "imageUrl", label: "Bild-URL", type: "url" },
  { name: "suggestedMaxSeats", label: "Teilnehmerzahl (Vorgabe)", type: "number", min: 1, max: 2147483647, step: "1" },
  { name: "suggestedTicketPrice", label: "Ticketpreis (Vorgabe)", type: "number", min: 0, max: 99999999.99, step: "0.01" },
  { name: "suggestedCurrency", label: "Währung", maxLength: 3 },
];
function SeriesForm({ slug, row, venues, trainers, onSaved, onCancel }: { slug: string; row?: SeriesRow; trainers: TrainerOption[]; venues: VenueOption[]; onSaved: (message: string) => void; onCancel: () => void }) {
  const [trainerBusy, setTrainerBusy] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState(row?.suggestedTrainerId ?? "");
  const [state, action, pending] = useActionState<SeriesState, FormData>(async (previous, form) => {
    const result = await saveSeries(slug, row?.id ?? null, previous, form);
    if (result.success) onSaved(result.message!);
    return result;
  }, {});
  function error(name: keyof SeriesValues) { return state.errors?.[name] && <p id={`error-${name}`} className="mt-1 text-xs text-red-700 dark:text-red-300">{state.errors[name]?.join(" ")}</p>; }
  return <form action={action} onSubmit={(e) => { if (trainerBusy) e.preventDefault(); }} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 className="font-semibold">{row ? "Eventserie bearbeiten" : "Eventserie erstellen"}</h2>
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      {fields.map(({ name, label, ...attributes }) => <div key={name}><label htmlFor={`series-${name}`} className="text-sm">{label}</label><input {...attributes} id={`series-${name}`} name={name} required={name === "name" || name === "suggestedCurrency"} defaultValue={row?.[name] ?? (name === "suggestedCurrency" ? "EUR" : "")} aria-invalid={!!state.errors?.[name]} aria-describedby={state.errors?.[name] ? `error-${name}` : undefined} className={inputClass} />{error(name)}</div>)}
      <TrainerPicker slug={slug} trainers={trainers} name="suggestedTrainerId" value={selectedTrainer ? [selectedTrainer] : []} onChange={(ids) => setSelectedTrainer(ids[0] ?? "")} onBusy={setTrainerBusy} errors={state.errors?.suggestedTrainerId} legacyName={row?.suggestedTrainerName} />
      <div><label htmlFor="series-venue" className="text-sm">Venue (Vorgabe)</label><select id="series-venue" name="suggestedVenueId" defaultValue={row?.suggestedVenueId ?? ""} className={inputClass}><option value="">Keine Venue</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select>{error("suggestedVenueId")}</div>
      <div className="sm:col-span-2"><label htmlFor="series-description" className="text-sm">Beschreibung</label><textarea id="series-description" name="description" rows={5} maxLength={20000} defaultValue={row?.description ?? ""} className={inputClass} />{error("description")}</div>
    </fieldset>
    <p className="text-xs text-zinc-500">Vorgaben dienen als Vorlage. Bestehende Events werden durch Änderungen an der Serie nicht verändert.</p>
    {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
    <div className="flex gap-3"><button disabled={pending || trainerBusy} className={primaryClass}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending || trainerBusy} onClick={onCancel} className="text-sm underline">Abbrechen</button></div>
  </form>;
}
function DeleteSeries({ slug, row, onDeleted }: { slug: string; row: SeriesRow; onDeleted: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<SeriesState, FormData>(async (previous, form) => {
    const result = await deleteSeries(slug, row.id, previous, form);
    if (result.success) onDeleted(result.message!);
    return result;
  }, {});
  return <div className="max-w-64">{confirm ? <form action={action} className="space-y-2"><p>„{row.name}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" /><div className="flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht ..." : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirm(false)} className="underline">Abbrechen</button></div></form> : <button type="button" disabled={row._count.events > 0} title={row._count.events ? "Diese Serie hat noch Events." : "Eventserie löschen"} aria-label={`${row.name} löschen`} onClick={() => setConfirm(true)} className="text-red-700 underline disabled:opacity-40 dark:text-red-300">Löschen</button>}{state.message && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
export function SeriesTable({ company, series, venues, trainers }: { company: { name: string; slug: string }; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[] }) {
  const [editor, setEditor] = useState<{ row?: SeriesRow } | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const visible = series.filter((row) => `${row.name} ${row.number} ${row.shortdescription ?? ""}`.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
  function saved(message: string) { setEditor(null); setMessage(message); }
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Eventserien</h1><p className="mt-1 text-sm text-zinc-500">{company.name}</p></div><button type="button" disabled={!!editor} onClick={() => { setEditor({}); setMessage(""); }} className={primaryClass}>+ Eventserie erstellen</button></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    {editor && <SeriesForm key={editor.row?.id ?? "new"} slug={company.slug} row={editor.row} venues={venues} trainers={trainers} onSaved={saved} onCancel={() => setEditor(null)} />}
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><label className="text-sm"><span className="sr-only">Eventserien durchsuchen</span><input type="search" placeholder="Eventserien durchsuchen …" value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} /></label><span className="text-sm text-zinc-500">{visible.length} von {series.length} Eventserien</span></div>
      <table className="w-full text-left text-sm"><caption className="sr-only">Eventserien von {company.name}</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Nr.", "Eventserie", "Venue", "Teilnehmer", "Preis", "Events", "Aktionen"].map((label) => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{row.number}</td><th scope="row" className="min-w-48 px-4 py-4 font-medium">{row.name}{row.shortdescription && <p className="mt-1 text-xs font-normal text-zinc-500">{row.shortdescription}</p>}</th><td className="px-4 py-4">{venues.find((venue) => venue.id === row.suggestedVenueId)?.name ?? "—"}</td><td className="px-4 py-4">{row.suggestedMaxSeats ?? "—"}</td><td className="whitespace-nowrap px-4 py-4">{row.suggestedTicketPrice === null ? "—" : `${row.suggestedTicketPrice.replace(".", ",")} ${row.suggestedCurrency}`}</td><td className="px-4 py-4">{row._count.events}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-3"><button type="button" disabled={!!editor} onClick={() => { setEditor({ row }); setMessage(""); }} className="text-primary-700 underline disabled:opacity-40 dark:text-primary-300">Bearbeiten</button>{!editor && <DeleteSeries slug={company.slug} row={row} onDeleted={setMessage} />}</div></td></tr>)}</tbody></table>
      {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{series.length ? "Keine passenden Eventserien gefunden." : "Noch keine Eventserien vorhanden. Erstelle die erste Eventserie über den Button oben."}</p>}
    </div>
    <p className="text-xs text-zinc-500">Serien mit zugeordneten Events können nicht gelöscht werden.</p>
  </main>;
}
