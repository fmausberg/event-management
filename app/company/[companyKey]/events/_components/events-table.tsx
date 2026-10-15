"use client";
import { TrainerPicker } from "@/components/trainer-picker";
import type { TrainerOption } from "@/lib/trainers/validation";
import { EventStaff } from "./event-staff";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveEvent, deleteEvent } from "../actions";
import { applySeries, emptyEvent, localDateTime, type EventRow, type EventState, type EventValues } from "@/lib/company-events/model";
import type { SeriesRow, VenueOption } from "@/lib/event-series/validation";
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";
const primary = "rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50";
const statuses = { DRAFT: "Entwurf", PUBLISHED: "Veröffentlicht", CANCELLED: "Abgesagt", COMPLETED: "Abgeschlossen" };
const statusColors = { DRAFT: "bg-yellow-100 text-yellow-800", PUBLISHED: "bg-green-100 text-green-800", CANCELLED: "bg-red-100 text-red-800", COMPLETED: "bg-zinc-200 text-zinc-700" };
function StatusTag({ status }: { status: EventValues["status"] }) { return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusColors[status]}`}>{statuses[status]}</span>; }
type Props = { canManage: boolean; company: { name: string; slug: string }; events: EventRow[]; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[] };
function EventForm({ slug, row, series, venues, trainers, onSaved, onCancel }: { slug: string; row?: EventRow; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[]; onSaved: (message: string) => void; onCancel: () => void }) {
 const [values, setValues] = useState<EventValues>(() => row ? { ...row, maxSeats: String(row.maxSeats), beginsAt: localDateTime(row.beginsAt), endsAt: localDateTime(row.endsAt) } : { ...emptyEvent });
 const [trainerBusy, setTrainerBusy] = useState(false);
 const panel = useRef<HTMLDialogElement>(null);
 useEffect(() => {
  const dialog = panel.current!;
  const previous = document.activeElement as HTMLElement | null;
  const desktop = window.matchMedia("(min-width: 1280px)");
  const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLSelectElement>("select")?.focus(); };
  open(); desktop.addEventListener("change", open);
  return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
 }, []);
 const [state, action, pending] = useActionState<EventState, FormData>(async (previous, data) => {
  for (const key of data.get("intent") === "cancel" ? [] : ["beginsAt", "endsAt"]) {
   const date = new Date(String(data.get(key)));
   if (!Number.isFinite(date.getTime())) return { message: "Bitte gib gültige Start- und Endzeiten ein." };
   data.set(key, date.toISOString());
  }
  const result = await saveEvent(slug, row?.id ?? null, previous, data);
  if (result.success) onSaved(result.message!);
  return result;
 }, {});
 function change(key: Exclude<keyof EventValues, "trainerIds">, value: string) { setValues((old) => ({ ...old, [key]: value })); }
 const fields: { key: Exclude<keyof EventValues, "trainerIds">; label: string; type?: string; required?: boolean; min?: number; step?: string; maxLength?: number }[] = [
  { key: "name", label: "Name", required: true, maxLength: 160 }, { key: "shortdescription", label: "Kurzbeschreibung" },
  { key: "beginsAt", label: "Beginn", type: "datetime-local", required: true }, { key: "endsAt", label: "Ende", type: "datetime-local", required: true },
  { key: "maxSeats", label: "Teilnehmerzahl", type: "number", required: true, min: 1, step: "1" },
  { key: "ticketPrice", label: "Ticketpreis", type: "number", required: true, min: 0, step: "0.01" },
  { key: "currency", label: "Währung", required: true, maxLength: 3 },
 ];
 return <dialog ref={panel} aria-labelledby="event-form-title" onCancel={(e) => { e.preventDefault(); if (!pending && !trainerBusy) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
  <form action={action} onSubmit={(e) => { if (trainerBusy) e.preventDefault(); }} className="space-y-4"><header className="flex items-center justify-between"><h2 id="event-form-title" className="font-semibold">{row ? "Event bearbeiten" : "Event erstellen"}</h2><button type="button" disabled={pending || trainerBusy} aria-label="Formular schließen" onClick={onCancel} className="rounded p-2 text-xl">×</button></header>
   <fieldset disabled={pending} className="space-y-4">
    <div><label htmlFor="event-series">Eventreihe</label><select id="event-series" name="eventSeriesId" value={values.eventSeriesId} onChange={(e) => { const selected = series.find((s) => s.id === e.target.value); setValues((old) => selected ? applySeries(old, selected) : { ...old, eventSeriesId: "" }); }} className={input}><option value="">Keine Eventreihe</option>{series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><p className="mt-1 text-xs text-zinc-500">Die Auswahl übernimmt die Vorgaben der Reihe und ersetzt die entsprechenden Formularfelder. Datum und Status bleiben erhalten. Alle Werte sind danach bearbeitbar.</p></div>
    {fields.map(({ key, label, ...attributes }) => <div key={key}><label htmlFor={`event-${key}`}>{label}</label><input {...attributes} id={`event-${key}`} name={key} value={values[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!state.errors?.[key]} aria-describedby={state.errors?.[key] ? `error-${key}` : undefined} className={input} />{state.errors?.[key] && <p id={`error-${key}`} className="text-xs text-red-700 dark:text-red-300">{state.errors[key]?.join(" ")}</p>}</div>)}
    <p className="text-xs text-zinc-500">Zeiten in deiner lokalen Zeitzone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
    <div><label htmlFor="event-description">Beschreibung</label><textarea id="event-description" name="description" value={values.description} onChange={(e) => change("description", e.target.value)} maxLength={20000} rows={4} className={input} />{state.errors?.description && <p className="text-xs text-red-700">{state.errors.description.join(" ")}</p>}</div>
    <TrainerPicker slug={slug} trainers={trainers} name="trainerIds" multiple value={values.trainerIds} onChange={(trainerIds) => setValues((old) => ({ ...old, trainerIds }))} onBusy={setTrainerBusy} errors={state.errors?.trainerIds} legacyName={row?.trainerName} />
    <div><label htmlFor="event-venue">Venue</label><select id="event-venue" name="venueId" value={values.venueId} onChange={(e) => change("venueId", e.target.value)} className={input}><option value="">Keine Venue</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
    <div className="flex items-center gap-2"><span>Status</span><StatusTag status={row?.status ?? "DRAFT"} /></div>
   </fieldset>
   {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
   <div className="flex flex-wrap gap-3">
    {!row || row.status === "DRAFT" ? <>
     <button name="intent" value="draft" disabled={pending || trainerBusy} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Entwurf speichern</button>
     <button name="intent" value="publish" disabled={pending || trainerBusy} className={primary}>Veröffentlichen</button>
    </> : <button name="intent" value="save" disabled={pending || trainerBusy} className={primary}>Speichern</button>}
    {row?.status === "PUBLISHED" && <button name="intent" value="cancel" formNoValidate disabled={pending || trainerBusy} onClick={(e) => { if (!window.confirm("Event wirklich absagen? Nicht gespeicherte Formularänderungen werden dabei verworfen. Bereits bezahlte Tickets werden nicht automatisch erstattet.")) e.preventDefault(); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">Absagen</button>}
    <button type="button" disabled={pending || trainerBusy} onClick={onCancel} className="text-sm underline">Abbrechen</button>
   </div>
  </form>
  {row && <EventStaff slug={slug} eventId={row.id} />}
 </dialog>;
}
function DeleteEvent({ slug, row, onDeleted }: { slug: string; row: EventRow; onDeleted: (message: string) => void }) {
 const [confirming, setConfirming] = useState(false);
 const [state, action, pending] = useActionState<EventState, FormData>(async (previous, data) => { const result = await deleteEvent(slug, row.id, previous, data); if (result.success) onDeleted(result.message!); return result; }, {});
 return <div className="max-w-64">{confirming ? <form action={action}><p>„{row.name}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" /><div className="mt-2 flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline">Abbrechen</button></div></form> : <button type="button" disabled={row._count.bookings > 0 || row._count.platformEvents > 0} title="Löschen nur ohne Buchungen und Plattformzuordnungen" onClick={() => setConfirming(true)} className="text-red-700 underline disabled:opacity-40 dark:text-red-300">Löschen</button>}{state.message && <p role="alert" className="text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
export function EventsTable({ company, events, series, venues, trainers, canManage }: Props) {
 const [editor, setEditor] = useState<{ row?: EventRow } | null>(null);
 const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
 const visible = events.filter((e) => `${e.name} ${e.number}`.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
 return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-96" : ""}`}>
  <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Events</h1><p className="text-sm text-zinc-500">{company.name}</p></div>{canManage && <button type="button" disabled={!!editor} onClick={() => { setEditor({}); setMessage(""); }} className={primary}>+ Event erstellen</button>}</header>
  {message && <p role="status" className="text-green-700 dark:text-green-300">{message}</p>}
  {canManage && editor && <EventForm key={editor.row?.id ?? "new"} slug={company.slug} row={editor.row} series={series} venues={venues} trainers={trainers} onCancel={() => setEditor(null)} onSaved={(text) => { setEditor(null); setMessage(text); }} />}
  <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
   <div className="flex items-center justify-between gap-4 p-4"><label><span className="sr-only">Events durchsuchen</span><input type="search" placeholder="Events durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} className={input} /></label><span className="text-sm text-zinc-500">{visible.length} von {events.length} Events</span></div>
   <table className="w-full text-left text-sm"><caption className="sr-only">Events von {company.name}</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Nr.", "Event", "Beginn (Europe/Berlin)", "Reihe", "Venue", "Status", "(freie) Plätze", "Preis", "Aktionen"].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{row.number}</td><th scope="row" className="px-4 py-4 font-medium">{row.name}</th><td className="whitespace-nowrap px-4 py-4">{new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(row.beginsAt))}</td><td className="px-4 py-4">{series.find((s) => s.id === row.eventSeriesId)?.name ?? "—"}</td><td className="px-4 py-4">{venues.find((v) => v.id === row.venueId)?.name ?? "—"}</td><td className="px-4 py-4"><StatusTag status={row.status} /></td><td className="px-4 py-4"><Link href={`/company/${encodeURIComponent(company.slug)}/events/${encodeURIComponent(row.id)}/tickets`} aria-label={`Ticketverwaltung: ${row.remainingSeats} von ${row.maxSeats} Plätzen frei`} className="text-primary-700 underline dark:text-primary-300">{row.remainingSeats} / {row.maxSeats}</Link></td><td className="whitespace-nowrap px-4 py-4">{row.ticketPrice.replace(".", ",")} {row.currency}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-3"><Link href={`/company/${encodeURIComponent(company.slug)}/events/${encodeURIComponent(row.id)}/bookings`} className="text-primary-700 underline dark:text-primary-300">Bookings ({row._count.bookings})</Link>{canManage && <button type="button" disabled={!!editor} onClick={() => { setEditor({ row }); setMessage(""); }} className="text-primary-700 underline disabled:opacity-40 dark:text-primary-300">Bearbeiten</button>}{canManage && !editor && <DeleteEvent slug={company.slug} row={row} onDeleted={setMessage} />}</div></td></tr>)}</tbody></table>
   {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{events.length ? "Keine passenden Events gefunden." : "Noch keine Events vorhanden. Erstelle das erste Event über den Button oben."}</p>}
  </div>
 </main>;
}
