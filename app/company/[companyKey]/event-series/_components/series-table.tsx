"use client";
import { UnsavedChangesForm } from "@/components/unsaved-changes";
import { TaxOverrideFields } from "@/components/tax-override-fields";
import { DescriptionEditor } from "@/components/description-editor";
import { DescriptionHtml } from "@/components/description-html";
import { isDescriptionEmpty } from "@/lib/descriptions/html";
import { cancellationPolicyText } from "@/lib/cancellations/policy";
import { SeriesPreviewDialog } from "./series-preview-dialog";
import type { SeriesPreview } from "@/lib/event-series/preview";
import { CancellationPolicyField } from "@/components/cancellation-policy-field";
import Link from "next/link";
import { EventImage } from "../../events/_components/event-image";
import { TrainerPicker } from "@/components/trainer-picker";
import type { TrainerOption } from "@/lib/trainers/validation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { deleteSeries, saveSeries } from "../actions";
import type { SeriesRow, SeriesState, SeriesValues, VenueOption } from "@/lib/event-series/validation";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";
const primaryClass = "rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const fields: { name: keyof SeriesValues; label: string; type?: string; maxLength?: number; min?: number; max?: number; step?: string }[] = [
  { name: "name", label: "Name", maxLength: 160 },
  { name: "shortdescription", label: "Kurzbeschreibung", maxLength: 500 },
  { name: "suggestedDuration", label: "Dauer in Minuten (Vorgabe)", type: "number", min: 1, max: 2147483647, step: "1" },
  { name: "suggestedMaxSeats", label: "Teilnehmerzahl (Vorgabe)", type: "number", min: 1, max: 2147483647, step: "1" },
  { name: "suggestedTicketPrice", label: "Ticketpreis (Vorgabe)", type: "number", min: 0, max: 99999999.99, step: "0.01" },
];
export function SeriesForm({ slug, row, venues, trainers, onSaved, onCancel, inline = false, readOnly = false }: { inline?: boolean; readOnly?: boolean; slug: string; row?: SeriesRow; trainers: TrainerOption[]; venues: VenueOption[]; onSaved: (message: string, id?: string) => void; onCancel: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (inline) {
      if (!readOnly) formElement.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus({ preventScroll: true });
      return;
    }
    const dialog = panel.current!;
    const previous = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus(); };
    open(); desktop.addEventListener("change", open);
    return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
  }, [inline, readOnly]);
  const [cancellationMinutes, setCancellationMinutes] = useState(row?.suggestedFreeCancellationUntilMinutesBeforeStart?.toString() ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [trainerBusy, setTrainerBusy] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState(row?.suggestedTrainerId ?? "");
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const submitted = useRef<FormData | null>(null);
  const [state, action, pending] = useActionState<SeriesState, FormData>(async (previous, form) => {
    if (readOnly) return {};
    if (coverFile) form.set("coverImage", coverFile);
    else form.delete("coverImage");
    submitted.current = form;
    let result: SeriesState;
    try { result = await saveSeries(slug, row?.id ?? null, previous, form); }
    catch { result = { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." }; }
    if (result.preview) setPreview(result.preview);
    if (result.success) onSaved(result.message!, result.id);
    return result;
  }, {});
  function error(name: keyof SeriesValues) { return state.errors?.[name] && <p id={`error-${name}`} className="mt-1 text-xs text-red-700 dark:text-red-300">{state.errors[name]?.join(" ")}</p>; }
  const trainer = trainers.find(item => item.id === row?.suggestedTrainerId);
  const readValueClass = "mt-1 min-h-11 rounded-lg border border-transparent px-3 py-2 whitespace-pre-wrap break-words";
  const content = (
    <UnsavedChangesForm saveState={state} ref={formElement} action={action} onSubmit={(e) => { if (readOnly || trainerBusy || preview) e.preventDefault(); }} className="space-y-4">
    {!inline && <header className="flex items-center justify-between"><h2 id="series-form-title" className="font-semibold">{row ? "Veranstaltungsreihe bearbeiten" : "Veranstaltungsreihe erstellen"}</h2><button type="button" disabled={pending || trainerBusy} aria-label="Formular schließen" data-discard-changes onClick={onCancel} className="rounded p-2 text-xl">×</button></header>}
    <fieldset disabled={pending || !!preview} className={inline ? "grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "space-y-4"}>
      <div className={inline ? "grid min-w-0 gap-4 sm:grid-cols-2" : "space-y-4"}>
      {!readOnly && <TaxOverrideFields slug={slug} kind="series" id={row?.id} />}
      {fields.map(({ name, label, ...attributes }) => <div key={name} className="min-w-0"><label htmlFor={`series-${name}`} className="text-sm text-zinc-500">{label}</label>{readOnly ? <p id={`series-${name}`} className={readValueClass}>{row?.[name] ?? "—"}{name === "suggestedTicketPrice" && row?.suggestedTicketPrice !== null ? ` ${row?.suggestedCurrency ?? "EUR"}` : ""}</p> : <><input {...attributes} id={`series-${name}`} name={name} required={name === "name"} defaultValue={row?.[name] ?? ""} aria-invalid={!!state.errors?.[name]} aria-describedby={state.errors?.[name] ? `error-${name}` : undefined} className={inputClass} />{error(name)}</>}</div>)}
      <div className="min-w-0">{readOnly ? <><p className="text-sm text-zinc-500">Kostenfreie Stornofrist (optional)</p><p className={readValueClass}>{cancellationPolicyText(row?.suggestedFreeCancellationUntilMinutesBeforeStart ?? null)}</p></> : <CancellationPolicyField name="suggestedFreeCancellationUntilMinutesBeforeStart" value={cancellationMinutes} onChange={setCancellationMinutes} error={state.errors?.suggestedFreeCancellationUntilMinutesBeforeStart} />}</div>

      <div className="min-w-0">{readOnly ? <><p className="text-sm text-zinc-500">Trainer (Vorgabe)</p><p className={readValueClass}>{trainer ? `${trainer.firstName} ${trainer.lastName}` : row?.suggestedTrainerName || "—"}</p></> : <TrainerPicker slug={slug} trainers={trainers} name="suggestedTrainerId" value={selectedTrainer ? [selectedTrainer] : []} onChange={(ids) => setSelectedTrainer(ids[0] ?? "")} onBusy={setTrainerBusy} errors={state.errors?.suggestedTrainerId} legacyName={row?.suggestedTrainerName} />}</div>
      <div><label htmlFor="series-venue" className="text-sm text-zinc-500">Ort (Vorgabe)</label>{readOnly ? <p id="series-venue" className={readValueClass}>{venues.find(venue => venue.id === row?.suggestedVenueId)?.name ?? "—"}</p> : <><select id="series-venue" name="suggestedVenueId" defaultValue={row?.suggestedVenueId ?? ""} className={inputClass}><option value="">Keinen Ort</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select>{error("suggestedVenueId")}</>}</div>
      <div className="sm:col-span-2 min-w-0"><label htmlFor="series-description" className="text-sm text-zinc-500">Beschreibung</label>{readOnly ? <div id="series-description" className={readValueClass}>{isDescriptionEmpty(row?.description) ? "—" : <DescriptionHtml html={row?.description} />}</div> : <><SeriesDescription value={row?.description ?? ""} />{error("description")}</>}</div>
      </div>
      <div className="w-full min-w-0 max-w-xl"><p className="mb-1 text-sm text-zinc-500">Titelbild</p>{readOnly ? row?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt={`Titelbild: ${row.name}`} className="aspect-video w-full rounded-lg object-cover" />
      ) : <p className={readValueClass}>Kein Titelbild</p> : <EventImage imageUrl={row?.imageUrl} onFileChange={setCoverFile} />}</div>
    </fieldset>
    {!readOnly && <><p className="text-xs text-zinc-500">Vorgaben dienen als Vorlage. Änderungen können beim Speichern einzeln auf zukünftige Veranstaltungen übertragen werden.</p>
    {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
    <div className="flex gap-3"><button disabled={pending || trainerBusy} className={primaryClass}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending || trainerBusy} data-discard-changes onClick={onCancel} className="text-sm underline">Abbrechen</button></div></>}
  </UnsavedChangesForm>
  );
  return <>{inline ? <div>{content}</div> : <dialog ref={panel} aria-labelledby="series-form-title" onCancel={(e) => { e.preventDefault(); if (!pending && !trainerBusy) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">{content}</dialog>}
    {preview && <SeriesPreviewDialog key={preview.token} preview={preview} pending={pending} message={state.message} onCancel={() => { setPreview(null); submitted.current = null; }} onApply={(selection) => {
      const form = submitted.current!;
      form.set("seriesPreviewToken", preview.token);
      form.set("seriesSelection", JSON.stringify(selection));
      startTransition(() => action(form));
    }} />}
  </>;
}
function DeleteSeries({ slug, row, onDeleted }: { slug: string; row: SeriesRow; onDeleted: (message: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState<SeriesState, FormData>(async (previous, form) => {
    const result = await deleteSeries(slug, row.id, previous, form);
    if (result.success) onDeleted(result.message!);
    return result;
  }, {});
  return <div className="max-w-64">{confirm ? <form action={action} className="space-y-2"><p>„{row.name}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" /><div className="flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht ..." : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirm(false)} className="underline">Abbrechen</button></div></form> : <button type="button" disabled={row._count.events > 0} title={row._count.events ? "Diese Veranstaltungsreihe hat noch Veranstaltungen." : "Veranstaltungsreihe löschen"} aria-label={`${row.name} löschen`} onClick={() => setConfirm(true)} className="rounded-lg p-2 text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg></button>}{state.message && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
type SeriesSortKey = "number" | "name" | "venue" | "duration" | "participants" | "price" | "events";
const seriesColumns: { key: SeriesSortKey; label: string }[] = [
  { key: "number", label: "Nr." },
  { key: "name", label: "Veranstaltungsreihe" },
  { key: "venue", label: "Ort" },
  { key: "duration", label: "Dauer" },
  { key: "participants", label: "Teilnehmer" },
  { key: "price", label: "Preis" },
  { key: "events", label: "Veranstaltungen" },
];
export function SeriesTable({ company, series, venues }: { company: { name: string; slug: string }; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[] }) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [sort, setSort] = useState<{ key: SeriesSortKey; direction: "asc" | "desc" } | null>(null);
  function sortValue(row: SeriesRow, key: SeriesSortKey): string | number | null {
    if (key === "number") return row.number;
    if (key === "name") return row.name;
    if (key === "venue") return venues.find(venue => venue.id === row.suggestedVenueId)?.name ?? null;
    if (key === "duration") return row.suggestedDuration;
    if (key === "participants") return row.suggestedMaxSeats;
    if (key === "price") return row.suggestedTicketPrice === null || row.suggestedTicketPrice === "" ? null : Number(row.suggestedTicketPrice);
    return row._count.events;
  }
  function changeSort(key: SeriesSortKey) {
    setSort(current => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  }
  const filtered = series.filter((row) => `${row.name} ${row.number} ${row.shortdescription ?? ""}`.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
  const visible = sort ? filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = sortValue(left.row, sort.key), b = sortValue(right.row, sort.key);
    if (a === null || a === "") return b === null || b === "" ? left.index - right.index : 1;
    if (b === null || b === "") return -1;
    const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "de-DE", { numeric: true, sensitivity: "base" });
    return (sort.direction === "asc" ? compared : -compared) || left.index - right.index;
  }).map(item => item.row) : filtered;
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Veranstaltungsreihen</h1><p className="mt-1 text-sm text-zinc-500">{company.name}</p></div><Link href={`/company/${encodeURIComponent(company.slug)}/event-series/new`} className={primaryClass}>+ Veranstaltungsreihe erstellen</Link></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><label className="text-sm"><span className="sr-only">Veranstaltungsreihen durchsuchen</span><input type="search" placeholder="Veranstaltungsreihen durchsuchen …" value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} /></label><span className="text-sm text-zinc-500">{visible.length} von {series.length} Veranstaltungsreihen</span></div>
      <table className="w-full text-left text-sm"><caption className="sr-only">Veranstaltungsreihen von {company.name}</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{seriesColumns.map(column => <th key={column.key} scope="col" aria-sort={sort?.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="px-2 py-2"><button type="button" onClick={() => changeSort(column.key)} className="flex w-full items-center gap-1 rounded px-2 py-1 text-left font-semibold hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-primary-600 dark:hover:bg-zinc-800">{column.label}<span aria-hidden="true" className="w-3">{sort?.key === column.key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}<th scope="col" className="px-4 py-3">Aktionen</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{row.number}</td><th scope="row" className="min-w-48 px-4 py-4 font-medium"><Link href={`/company/${encodeURIComponent(company.slug)}/event-series/${encodeURIComponent(row.id)}`} className="text-primary-700 underline focus-visible:outline-primary-600 dark:text-primary-300">{row.name}</Link>{row.shortdescription && <p className="mt-1 text-xs font-normal text-zinc-500">{row.shortdescription}</p>}</th><td className="px-4 py-4">{venues.find((venue) => venue.id === row.suggestedVenueId)?.name ?? "—"}</td><td className="whitespace-nowrap px-4 py-4">{row.suggestedDuration ? `${row.suggestedDuration} Min.` : "—"}</td><td className="px-4 py-4">{row.suggestedMaxSeats ?? "—"}</td><td className="whitespace-nowrap px-4 py-4">{row.suggestedTicketPrice === null ? "—" : `${row.suggestedTicketPrice.replace(".", ",")} ${row.suggestedCurrency}`}</td><td className="px-4 py-4">{row._count.events}</td><td className="px-4 py-4"><div className="flex items-start gap-2"><DeleteSeries slug={company.slug} row={row} onDeleted={setMessage} /></div></td></tr>)}</tbody></table>
      {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{series.length ? "Keine passenden Veranstaltungsreihen gefunden." : "Noch keine Veranstaltungsreihen vorhanden. Erstelle die erste Veranstaltungsreihe über den Button oben."}</p>}
    </div>
    <p className="text-xs text-zinc-500">Veranstaltungsreihen mit zugeordneten Veranstaltungen können nicht gelöscht werden.</p>
  </main>;
}

function SeriesDescription({ value }: { value: string }) {
 const [html, setHtml] = useState(value);
 return <DescriptionEditor id="series-description" value={html} onChange={setHtml} />;
}
