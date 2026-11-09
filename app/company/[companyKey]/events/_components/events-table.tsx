"use client";
import { DescriptionEditor } from "@/components/description-editor";
import { CancellationPolicyField } from "@/components/cancellation-policy-field";
import { TrainerPicker } from "@/components/trainer-picker";
import type { TrainerOption } from "@/lib/trainers/validation";
import { EventStaff } from "./event-staff";
import { PublishConfirmation } from "./publish-confirmation";
import { CancelConfirmation } from "./cancel-confirmation";
import { EventImage } from "./event-image";
import { BatchDates } from "./batch-dates";
import type { BatchSelection } from "@/lib/company-events/batch-schedule";
import { formatBerlinDateTime } from "@/lib/events/berlin-date-time";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveEvent, deleteEvent, sendTrainerInfo, type TrainerReminderActionState } from "../actions";
import { suggestedEndDate, applySeries, emptyEvent, localDateTime, type EventRow, type EventState, type EventValues } from "@/lib/company-events/model";
import type { SeriesRow, VenueOption } from "@/lib/event-series/validation";
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";
const primary = "rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50";
const statuses = { DRAFT: "Entwurf", PUBLISHED: "Veröffentlicht", CANCELLED: "Abgesagt", COMPLETED: "Abgeschlossen" };
const statusColors = { DRAFT: "bg-yellow-100 text-yellow-800", PUBLISHED: "bg-green-100 text-green-800", CANCELLED: "bg-red-100 text-red-800", COMPLETED: "bg-zinc-200 text-zinc-700" };
const eventDateTime = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const trainerReminderDateTime = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
const berlinDateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });
function berlinWeek(value: string) {
 const parts = Object.fromEntries(berlinDateParts.formatToParts(new Date(value)).map(part => [part.type, part.value]));
 const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
 const mondayOffset = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - mondayOffset);
 return date.toISOString().slice(0, 10);
}
function missingWeeks(fromMonday: string, toMonday: string) {
 const direction = fromMonday < toMonday ? 1 : -1;
 const cursor = new Date(`${fromMonday}T00:00:00Z`);
 const destination = new Date(`${toMonday}T00:00:00Z`).getTime();
 const weeks: string[] = [];
 cursor.setUTCDate(cursor.getUTCDate() + 7 * direction);
 while (cursor.getTime() !== destination) {
  weeks.push(cursor.toISOString().slice(0, 10));
  cursor.setUTCDate(cursor.getUTCDate() + 7 * direction);
 }
 return weeks;
}
function weekLabel(monday: string) {
 const thursday = new Date(`${monday}T00:00:00Z`);
 thursday.setUTCDate(thursday.getUTCDate() + 3);
 const year = thursday.getUTCFullYear();
 const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000)) + 1;
 return `KW ${week}/${year}`;
}
type SortKey = "number" | "name" | "beginsAt" | "series" | "venue" | "status" | "remainingSeats" | "price" | "bookings";
const columns: { key: SortKey; label: string }[] = [
 { key: "number", label: "Nr." }, { key: "name", label: "Veranstaltung" }, { key: "beginsAt", label: "Beginn (Europe/Berlin)" },
 { key: "series", label: "Veranstaltungsreihe" }, { key: "venue", label: "Orte" }, { key: "status", label: "Status" },
 { key: "remainingSeats", label: "(freie) Plätze" }, { key: "price", label: "Preis" }, { key: "bookings", label: "Buchungen" },
];
function RequiredMark() { return <><span aria-hidden="true" className="ml-1 text-xs text-red-600 dark:text-red-400">*</span><span className="sr-only"> (zum Veröffentlichen erforderlich)</span></>; }
export function StatusTag({ status }: { status: EventValues["status"] }) { return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusColors[status]}`}>{statuses[status]}</span>; }
type Props = { defaultSeriesId?: string; seriesDetails?: React.ReactNode; seriesHistory?: React.ReactNode; seriesNotes?: React.ReactNode; canManage: boolean; company: { name: string; slug: string }; events: EventRow[]; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[] };
export function TrainerReminderControls({ slug, row, embedded = false }: { slug: string; row: EventRow; embedded?: boolean }) {
 const [sentAt, setSentAt] = useState(row.trainerReminderSentAt ?? null);
 const requestId = useRef<string | null>(null);
 const [sendState, sendAction, sending] = useActionState<TrainerReminderActionState, FormData>(async (previous) => {
  requestId.current ??= crypto.randomUUID();
  const result = await sendTrainerInfo(slug, row.id, requestId.current, previous);
  if (result.sentAt) { setSentAt(result.sentAt); requestId.current = null; }
  return result;
 }, {});
 return <section aria-labelledby="trainer-info-title" className={embedded ? "space-y-3" : "mt-6 space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-800"}>
  {!embedded && <h3 id="trainer-info-title" className="font-semibold">Trainer-Info</h3>}
  <p className="text-xs leading-relaxed text-zinc-500">Ohne manuelle Aktion wird die Trainer-Info automatisch eine Stunde vor Beginn der Veranstaltung versendet.</p>
  <div className="flex flex-wrap items-center gap-2">
    <input id={`trainer-info-status-${row.id}`} type="checkbox" checked={!!sentAt} disabled readOnly className="h-4 w-4 rounded border-zinc-300 text-primary-600" />
    <label htmlFor={`trainer-info-status-${row.id}`} className="text-sm">Trainer-Info versendet</label>
    <span className="ml-2 whitespace-nowrap text-xs text-zinc-500">{sentAt ? `${trainerReminderDateTime.format(new Date(sentAt))} Uhr` : "Noch nicht versendet"}</span>
  </div>
  <form action={sendAction}>
   <button disabled={sending} className={primary}>Trainer Info schicken</button>
  </form>
  {sendState.message && <p role="status" className={`text-sm ${sendState.success ? "text-green-700 dark:text-green-300" : "text-zinc-600 dark:text-zinc-300"}`}>{sendState.message}</p>}
 </section>;
}
export function EventForm({ slug, row, defaultSeries, series, venues, trainers, onSaved, onCancel, inline = false, formId, onBusyChange }: { inline?: boolean; formId?: string; onBusyChange?: (busy: boolean) => void; slug: string; row?: EventRow; defaultSeries?: SeriesRow; series: SeriesRow[]; trainers: TrainerOption[]; venues: VenueOption[]; onSaved: (message: string, id?: string) => void; onCancel: () => void }) {
 const [values, setValues] = useState<EventValues>(() => row ? { ...row, maxSeats: row.maxSeats?.toString() ?? "", beginsAt: localDateTime(row.beginsAt), endsAt: localDateTime(row.endsAt) } : defaultSeries ? applySeries({ ...emptyEvent }, defaultSeries) : { ...emptyEvent });
 const manualEnd = useRef(false);
 const [multiple, setMultiple] = useState(false);
 const [batch, setBatch] = useState<BatchSelection>({ dates: [], startTime: "", endTime: "", endDayOffset: "0", timeMode: defaultSeries?.suggestedDuration ? "duration" : "clock", duration: defaultSeries?.suggestedDuration?.toString() ?? "" });
 const batchInitialized = useRef(false);
 const [submission, setSubmission] = useState({ seriesId: "", batch: "" });
 function setCreationMode(nextMultiple: boolean) {
  if (nextMultiple && !values.eventSeriesId) return;
  if (nextMultiple && !batchInitialized.current) {
   const start = values.beginsAt ? new Date(values.beginsAt) : null;
   const end = values.endsAt ? new Date(values.endsAt) : null;
   const startLocal = start && Number.isFinite(start.getTime()) ? formatBerlinDateTime(start) : "";
   const endLocal = end && Number.isFinite(end.getTime()) ? formatBerlinDateTime(end) : "";
   const duration = series.find(item => item.id === values.eventSeriesId)?.suggestedDuration;
   setBatch({ dates: startLocal ? [startLocal.slice(0, 10)] : [], startTime: startLocal.slice(11, 16), endTime: endLocal.slice(11, 16),
    endDayOffset: startLocal && endLocal ? String(Math.max(0, Math.round((Date.parse(`${endLocal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${startLocal.slice(0, 10)}T00:00:00Z`)) / 86400000))) : "0",
    timeMode: duration && !manualEnd.current ? "duration" : "clock", duration: duration?.toString() ?? "" });
   batchInitialized.current = true;
  }
  setMultiple(nextMultiple);
 }
 const [trainerBusy, setTrainerBusy] = useState(false);
 const [coverFile, setCoverFile] = useState<File | null>(null);
 const [publishWarnings, setPublishWarnings] = useState<string[] | null>(null);
 const publishDecision = useRef<((publish: boolean) => void) | null>(null);
 const [cancelConfirmation, setCancelConfirmation] = useState(false);
 const cancelButton = useRef<HTMLButtonElement>(null);
 const cancelSubmit = useRef<HTMLButtonElement>(null);
 useEffect(() => () => { publishDecision.current?.(false); }, []);
 function decideCancellation(cancel: boolean) {
  setCancelConfirmation(false);
  if (cancel && cancelSubmit.current) cancelSubmit.current.form?.requestSubmit(cancelSubmit.current);
  if (!cancel) requestAnimationFrame(() => cancelButton.current?.focus());
 }
 function decidePublication(publish: boolean) {
  setPublishWarnings(null);
  publishDecision.current?.(publish);
  publishDecision.current = null;
  if (!publish) requestAnimationFrame(() => formElement.current?.querySelector<HTMLElement>("#event-description")?.focus());
 }
 const focusStartDate = !row && !!defaultSeries;
 const panel = useRef<HTMLDialogElement>(null);
 const formElement = useRef<HTMLFormElement>(null);
 useEffect(() => {
 if (inline) {
  formElement.current?.querySelector<HTMLElement>("#event-series")?.focus({ preventScroll: true });
  return;
 }
  const dialog = panel.current!;
  const previous = document.activeElement as HTMLElement | null;
  const desktop = window.matchMedia("(min-width: 1280px)");
  const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLElement>(focusStartDate ? "#event-beginsAt" : "select")?.focus(); };
  open(); desktop.addEventListener("change", open);
  return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
 }, [focusStartDate, inline]);
 const [state, action, pending] = useActionState<EventState, FormData>(async (previous, data) => {
  // React resets uncontrolled file inputs after an action, including validation errors.
  // Keep the selected File alongside its preview so a retry still uploads that image.
  if (coverFile) data.set("coverImage", coverFile);
  else data.delete("coverImage");
  setSubmission({ seriesId: values.eventSeriesId, batch: JSON.stringify(batch) });
  for (const key of multiple || data.get("intent") === "cancel" ? [] : ["beginsAt", "endsAt"]) {
   if (!data.get(key)) continue;
   const date = new Date(String(data.get(key)));
   if (!Number.isFinite(date.getTime())) return { message: "Bitte gib gültige Start- und Endzeiten ein." };
   data.set(key, date.toISOString());
  }
  let result = await saveEvent(slug, row?.id ?? null, previous, data);
  if (result.warnings?.length) {
   const confirmed = await new Promise<boolean>((resolve) => {
    publishDecision.current = resolve;
    setPublishWarnings(result.warnings!);
   });
   if (!confirmed) return {};
   data.set("confirmMissingOptional", "yes");
   result = await saveEvent(slug, row?.id ?? null, previous, data);
  }
  if (result.success) onSaved(result.message!, result.id);
  return result;
 }, {});
 useEffect(() => { onBusyChange?.(pending || trainerBusy || !!publishWarnings || cancelConfirmation); }, [pending, trainerBusy, publishWarnings, cancelConfirmation, onBusyChange]);
 function change(key: Exclude<keyof EventValues, "trainerIds">, value: string) {
  if (key === "endsAt") manualEnd.current = !!value;
  setValues((old) => {
   const next = { ...old, [key]: value };
   const duration = series.find((item) => item.id === old.eventSeriesId)?.suggestedDuration;
   if (!row && key === "beginsAt" && !manualEnd.current && duration) next.endsAt = suggestedEndDate(value, duration);
   return next;
  });
 }
 const fields: { key: Exclude<keyof EventValues, "trainerIds">; label: string; type?: string; required?: boolean; min?: number; step?: string; maxLength?: number }[] = [
  { key: "name", label: "Name", required: true, maxLength: 160 }, { key: "shortdescription", label: "Kurzbeschreibung" },
  { key: "beginsAt", label: "Beginn", type: "datetime-local", required: true }, { key: "endsAt", label: "Ende", type: "datetime-local", required: true },
  { key: "maxSeats", label: "Teilnehmerzahl", type: "number", required: true, min: 1, step: "1" },
  { key: "ticketPrice", label: "Ticketpreis", type: "number", required: true, min: 0, step: "0.01" },
 ];
 const content = <>
  {/* React resets forms after resolved actions, including validation and dismissed warnings.
      Keep the editor intact; a successful save closes it via onSaved instead. */}
  <form ref={formElement} id={formId} action={action} noValidate onReset={(event) => event.preventDefault()} onSubmit={(e) => { if (pending || trainerBusy) e.preventDefault(); }} className="space-y-4">{!inline && <header className="flex items-center justify-between"><h2 id="event-form-title" className="font-semibold">{row ? "Veranstaltung bearbeiten" : "Veranstaltung erstellen"}</h2><button type="button" disabled={pending || trainerBusy} aria-label="Formular schließen" onClick={onCancel} className="rounded p-2 text-xl">×</button></header>}
   {!inline && <p className="text-xs text-zinc-500"><span className="text-red-600 dark:text-red-400">*</span> Zum Veröffentlichen erforderlich. Entwürfe dürfen unvollständig sein.</p>}
   <fieldset disabled={pending} className={inline ? "grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "space-y-4"}>
    <div className={inline ? "grid min-w-0 gap-4 sm:grid-cols-2" : "min-w-0 space-y-4"}>
    <div className={inline ? "sm:col-span-2" : undefined}><label htmlFor="event-series">Veranstaltungsreihe</label><select id="event-series" name="eventSeriesId" value={values.eventSeriesId} onChange={(e) => { const selected = series.find((s) => s.id === e.target.value); if (!selected) setMultiple(false); if (selected && batch.timeMode === "duration") setBatch(old => ({ ...old, duration: selected.suggestedDuration?.toString() ?? "" })); setValues((old) => {
     const next = selected ? applySeries(old, selected) : { ...old, eventSeriesId: "" };
     if (!row && !manualEnd.current) next.endsAt = suggestedEndDate(next.beginsAt, selected?.suggestedDuration);
     return next;
    }); }} className={input}><option value="">Keine Veranstaltungsreihe</option>{series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{!inline && <p className="mt-1 text-xs text-zinc-500">Die Auswahl übernimmt die Vorgaben der Reihe und ersetzt die entsprechenden Formularfelder. Beginn und Status bleiben erhalten. Bei neuen Veranstaltungen wird das Ende anhand der vorgegebenen Dauer berechnet, solange es nicht manuell angepasst wurde. Alle Werte sind danach bearbeitbar.</p>}</div>
    {!row && <fieldset className={inline ? "space-y-2 sm:col-span-2" : "space-y-2"}><legend className="mb-2 text-sm font-medium">Erstellung</legend><div className="flex flex-wrap gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="creationMode" value="single" checked={!multiple} onChange={() => setCreationMode(false)} />Eine Veranstaltung erstellen</label>
      <label className={`flex items-center gap-2 text-sm ${!values.eventSeriesId ? "text-zinc-400" : ""}`}><input type="radio" name="creationMode" value="multiple" checked={multiple} disabled={!values.eventSeriesId} onChange={() => setCreationMode(true)} />Mehrere Veranstaltungen erstellen</label>
    </div>{!values.eventSeriesId && <p className="text-xs text-zinc-500">Für mehrere Veranstaltungen zuerst eine Veranstaltungsreihe auswählen.</p>}</fieldset>}
    {inline && fields.filter(field => !multiple || !["beginsAt", "endsAt"].includes(field.key)).map(({ key, label, ...attributes }) => <div key={key} className="min-w-0"><label htmlFor={`event-${key}`} className="text-sm text-zinc-500">{label}<RequiredMark /></label><input {...attributes} id={`event-${key}`} name={key} value={values[key]} onChange={event => change(key, event.target.value)} aria-invalid={!!state.errors?.[key]} aria-describedby={state.errors?.[key] ? `error-${key}` : undefined} className={`${input} min-h-11 min-w-0 max-w-full`} />{state.errors?.[key] && <p id={`error-${key}`} className="text-xs text-red-700 dark:text-red-300">{state.errors[key]?.join(" ")}</p>}</div>)}
    {!inline && <div className="grid grid-cols-2 gap-4">{fields.filter(field => !["beginsAt", "endsAt"].includes(field.key)).map(({ key, label, ...attributes }) => <div key={key} className={key === "name" || key === "shortdescription" ? "col-span-2 min-w-0" : "min-w-0"}><label htmlFor={`event-${key}`}>{label}<RequiredMark /></label><input {...attributes} id={`event-${key}`} name={key} value={values[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!state.errors?.[key]} aria-describedby={state.errors?.[key] ? `error-${key}` : undefined} className={`${input} min-w-0 max-w-full`} />{state.errors?.[key] && <p id={`error-${key}`} className="text-xs text-red-700 dark:text-red-300">{state.errors[key]?.join(" ")}</p>}</div>)}</div>}

    {!inline && !multiple && <div className="grid grid-cols-2 gap-4">{fields.filter(field => ["beginsAt", "endsAt"].includes(field.key)).map(({ key, label, ...attributes }) => <div key={key} className={key === "name" || key === "shortdescription" ? "col-span-2 min-w-0" : "min-w-0"}><label htmlFor={`event-${key}`}>{label}<RequiredMark /></label><input {...attributes} id={`event-${key}`} name={key} value={values[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!state.errors?.[key]} aria-describedby={state.errors?.[key] ? `error-${key}` : undefined} className={`${input} min-w-0 max-w-full`} />{state.errors?.[key] && <p id={`error-${key}`} className="text-xs text-red-700 dark:text-red-300">{state.errors[key]?.join(" ")}</p>}</div>)}</div>}
    {(!inline || multiple) && <div className={inline ? "sm:col-span-2 min-w-0" : undefined}>{multiple ? <><BatchDates slug={slug} seriesId={values.eventSeriesId} value={batch} onChange={setBatch} suggestedDuration={series.find(item => item.id === values.eventSeriesId)?.suggestedDuration ?? null}
      conflictingDates={submission.seriesId === values.eventSeriesId ? state.conflictingDates : undefined}
      dateErrors={submission.seriesId === values.eventSeriesId && submission.batch === JSON.stringify(batch) ? state.dateErrors : undefined} />
      {(state.errors?.beginsAt || state.errors?.endsAt) && <p role="alert" className="text-xs text-red-700">{state.errors.beginsAt?.join(" ")} {state.errors.endsAt?.join(" ")}</p>}
      <p className="text-xs text-zinc-500">Alle übrigen Formularangaben gelten für jeden ausgewählten Termin. Es entstehen eigenständige Veranstaltungen dieser Reihe.</p>
    </> : <p className="text-xs text-zinc-500">Zeiten in deiner lokalen Zeitzone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>}</div>}
    <div><label htmlFor="event-venue">Ort<RequiredMark /></label><select id="event-venue" name="venueId" value={values.venueId} onChange={(e) => change("venueId", e.target.value)} className={input}><option value="">Keinen Ort</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>{state.errors?.venueId && <p className="text-xs text-red-700">{state.errors.venueId.join(" ")}</p>}</div>
    <div className={inline ? "min-w-0 min-h-32" : undefined}><TrainerPicker slug={slug} trainers={trainers} name="trainerIds" multiple value={values.trainerIds} onChange={(trainerIds) => setValues((old) => ({ ...old, trainerIds }))} onBusy={setTrainerBusy} errors={state.errors?.trainerIds} legacyName={row?.trainerName} /></div>

    <div className={inline ? "min-w-0 min-h-40" : undefined}><CancellationPolicyField name="freeCancellationUntilMinutesBeforeStart" value={values.freeCancellationUntilMinutesBeforeStart ?? ""} onChange={(value) => change("freeCancellationUntilMinutesBeforeStart", value)} error={state.errors?.freeCancellationUntilMinutesBeforeStart} /></div>

    <div className="flex items-center gap-2"><span>Status</span><StatusTag status={row?.status ?? "DRAFT"} /></div>
    <div className={inline ? "min-w-0 sm:col-span-2" : undefined}><label htmlFor="event-description">Beschreibung</label><DescriptionEditor id="event-description" value={values.description} onChange={(html) => change("description", html)} invalid={!!state.errors?.description} />{state.errors?.description && <p className="text-xs text-red-700">{state.errors.description.join(" ")}</p>}</div>
    </div>
    <div className="min-w-0"><EventImage imageUrl={row?.imageUrl} seriesImageUrl={row ? undefined : series.find((item) => item.id === values.eventSeriesId)?.imageUrl} onFileChange={setCoverFile} /></div>
   </fieldset>
   {inline && <p className="text-xs text-zinc-500">* Zum Veröffentlichen erforderlich. Entwürfe dürfen unvollständig sein. Zeiten in deiner lokalen Zeitzone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Die Auswahl einer Veranstaltungsreihe übernimmt deren Vorgaben und ersetzt die entsprechenden Formularfelder.</p>}
   {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
   <div className="flex flex-wrap gap-3">
    {!row || row.status === "DRAFT" ? <>
     <button name="intent" value="draft" disabled={pending || trainerBusy} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Entwurf speichern</button>
     <button name="intent" value="publish" disabled={pending || trainerBusy} className={primary}>Veröffentlichen</button>
    </> : <button name="intent" value="save" disabled={pending || trainerBusy} className={primary}>Speichern</button>}
    {row?.status === "PUBLISHED" && <>
     <button ref={cancelButton} type="button" disabled={pending || trainerBusy} onClick={() => setCancelConfirmation(true)} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">Absagen</button>
     <button ref={cancelSubmit} type="submit" name="intent" value="cancel" formNoValidate hidden disabled={pending || trainerBusy} />
    </>}
    <button type="button" disabled={pending || trainerBusy} onClick={onCancel} className="text-sm underline">Abbrechen</button>
   </div>
  </form>
  {row && !inline && <EventStaff slug={slug} eventId={row.id} />}
  {publishWarnings && <PublishConfirmation missing={publishWarnings} count={multiple ? batch.dates.length : undefined} onDecision={decidePublication} />}
  {cancelConfirmation && <CancelConfirmation onDecision={decideCancellation} />}
  {row && !inline && <TrainerReminderControls slug={slug} row={row} />}
 </>;
 return inline ? <div>{content}</div> : <dialog ref={panel} aria-labelledby="event-form-title" onCancel={(e) => { e.preventDefault(); if (!pending && !trainerBusy) onCancel(); }} className={`fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full ${multiple ? "max-w-3xl xl:w-[48rem]" : "max-w-md xl:w-[28rem]"} overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100`}>{content}</dialog>;
}
function DeleteEvent({ slug, row, onDeleted }: { slug: string; row: EventRow; onDeleted: (message: string) => void }) {
 const [confirming, setConfirming] = useState(false);
 const [state, action, pending] = useActionState<EventState, FormData>(async (previous, data) => { const result = await deleteEvent(slug, row.id, previous, data); if (result.success) onDeleted(result.message!); return result; }, {});
 return <div className="max-w-64">{confirming ? <form action={action}><p>„{row.name}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" /><div className="mt-2 flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline">Abbrechen</button></div></form> : <button type="button" disabled={row._count.bookings > 0 || row._count.platformEvents > 0} title="Löschen nur ohne Buchungen und Plattformzuordnungen" aria-label={`${row.name || "Unbenannter Entwurf"} löschen`} onClick={() => setConfirming(true)} className="rounded-lg px-2 py-0.5 text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg></button>}{state.message && <p role="alert" className="text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
export function EventsTable({ company, events, series, venues, trainers, canManage, seriesDetails, seriesHistory, seriesNotes, defaultSeriesId }: Props) {
 const visibleColumns = columns.filter(column => !seriesDetails || column.key !== "series");
 const [editor, setEditor] = useState<{ row?: EventRow } | null>(null);
 const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
 const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" } | null>({ key: "beginsAt", direction: "asc" });
 const [pastSort, setPastSort] = useState<typeof sort>({ key: "beginsAt", direction: "desc" });
 const [now] = useState(() => Date.now());
 const isPast = (row: EventRow) => row.status === "COMPLETED" || !!((row.endsAt || row.beginsAt) && new Date(row.endsAt || row.beginsAt).getTime() <= now);
 const today = formatBerlinDateTime(new Date(now)).slice(0, 10);
 const isPreviousDay = (row: EventRow) => {
  const date = row.beginsAt || row.endsAt;
  return !!date && formatBerlinDateTime(new Date(date)).slice(0, 10) < today;
 };
 const filtered = events.filter((e) => `${e.name} ${e.number}`.toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
 function sortValue(row: EventRow, key: SortKey): string | number | null {
  if (key === "number") return row.number; if (key === "name") return row.name || "";
  if (key === "beginsAt") return row.beginsAt ? new Date(row.beginsAt).getTime() : null;
  if (key === "series") return series.find(item => item.id === row.eventSeriesId)?.name ?? null;
  if (key === "venue") return venues.find(item => item.id === row.venueId)?.name ?? null;
  if (key === "status") return statuses[row.status]; if (key === "remainingSeats") return isPast(row) ? row.checkedInSeats : row.remainingSeats;
  if (key === "price") return row.ticketPrice === null || row.ticketPrice === "" ? null : Number(row.ticketPrice);
  return row._count.bookings;
 }
 function renderSection(rows: EventRow[], title: string, sort: { key: SortKey; direction: "asc" | "desc" } | null, setSort: React.Dispatch<React.SetStateAction<typeof sort>>, past = false) {
 const visible = sort ? rows.map((row, index) => ({ row, index })).sort((left, right) => {
  const a = sortValue(left.row, sort.key), b = sortValue(right.row, sort.key);
  if (a === null || a === "") return b === null || b === "" ? left.index - right.index : 1;
  if (b === null || b === "") return -1;
  const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "de-DE", { numeric: true, sensitivity: "base" });
  return (sort.direction === "asc" ? compared : -compared) || left.index - right.index;
 }).map(item => item.row) : rows;
 function changeSort(key: SortKey) { setSort(current => current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }); }
 function groupValue(row: EventRow) {
  if (sort?.key === "beginsAt") return row.beginsAt ? berlinWeek(row.beginsAt) : "NO_DATE";
  if (sort?.key === "venue") return venues.find(item => item.id === row.venueId)?.name ?? "NO_VENUE";
  if (sort?.key === "status") return row.status;
  return null;
 }
 const displayRows: ({ kind: "event"; row: EventRow; index: number } | { kind: "empty-week"; monday: string })[] = [];
 visible.forEach((row, index) => {
  if (sort?.key === "beginsAt" && index > 0 && row.beginsAt && visible[index - 1].beginsAt) {
   const previousWeek = berlinWeek(visible[index - 1].beginsAt!);
   const currentWeek = berlinWeek(row.beginsAt);
   if (previousWeek !== currentWeek) missingWeeks(previousWeek, currentWeek).forEach(monday => displayRows.push({ kind: "empty-week", monday }));
  }
  displayRows.push({ kind: "event", row, index });
 });
  return <details open className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
   <summary className="relative cursor-pointer rounded-xl px-4 py-4 pr-16 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">{title} <span className="ml-2 text-sm font-normal text-zinc-500">({visible.length})</span>
    {seriesDetails && defaultSeriesId && canManage && !past && <Link href={`/company/${encodeURIComponent(company.slug)}/events/new?seriesId=${encodeURIComponent(defaultSeriesId)}`} aria-label="Neue Veranstaltung dieser Reihe erstellen" title="Neue Veranstaltung dieser Reihe erstellen" onClick={event => event.stopPropagation()} className="absolute right-3 top-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary-600 text-2xl font-normal text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"><span aria-hidden="true">+</span></Link>}
   </summary>
  <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-800">
   <table className="w-full text-left text-sm"><caption className="sr-only">{title} von {company.name}</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{visibleColumns.map(column => <th key={column.key} scope="col" aria-sort={sort?.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className={`px-2 py-2 ${column.key === "remainingSeats" ? "text-center" : column.key === "price" || column.key === "bookings" ? "text-right" : ""}`}><button type="button" onClick={() => changeSort(column.key)} className={`flex w-full items-center gap-1 rounded px-2 py-1 font-semibold ${column.key === "remainingSeats" ? "justify-center text-center" : column.key === "price" || column.key === "bookings" ? "justify-end text-right" : "text-left"} hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-primary-600 dark:hover:bg-zinc-800`}>{past && column.key === "remainingSeats" ? "Eingecheckt / gekauft / gesamt" : column.label}<span aria-hidden="true" className="w-3">{sort?.key === column.key ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>)}<th scope="col" className="px-4 py-3">Aktionen</th></tr></thead><tbody>{displayRows.map(item => item.kind === "empty-week" ? <tr key={`empty-${item.monday}`} className="border-t-2 border-zinc-300 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/60"><td colSpan={visibleColumns.length + 1} className="px-4 py-1.5 text-center text-xs text-zinc-500 dark:text-zinc-400">{weekLabel(item.monday)} · keine Veranstaltungen</td></tr> : (() => { const { row, index } = item; return <tr key={row.id} className={`${index > 0 && groupValue(row) !== groupValue(visible[index - 1]) ? "border-t-2 border-zinc-400 dark:border-zinc-600" : "border-t border-zinc-200 dark:border-zinc-800"} align-top`}><td className="px-4 py-4">{row.number}</td><th scope="row" className="px-4 py-4 font-medium"><Link href={`/company/${encodeURIComponent(company.slug)}/events/${encodeURIComponent(row.id)}`} className="text-primary-700 underline focus-visible:outline-2 focus-visible:outline-primary-600 dark:text-primary-300">{row.name || "Unbenannter Entwurf"}</Link></th><td className="whitespace-nowrap px-4 py-4">{row.beginsAt ? eventDateTime.format(new Date(row.beginsAt)) : "Noch offen"}</td>{!seriesDetails && <td className="px-4 py-4">{(() => { const eventSeries = series.find((s) => s.id === row.eventSeriesId); return eventSeries ? <Link href={`/company/${encodeURIComponent(company.slug)}/event-series/${encodeURIComponent(eventSeries.id)}`} className="text-primary-700 underline focus-visible:outline-primary-600 dark:text-primary-300">{eventSeries.name}</Link> : "—"; })()}</td>}<td className="px-4 py-4">{venues.find((v) => v.id === row.venueId)?.name ?? "—"}</td><td className="px-4 py-4"><StatusTag status={row.status} /></td><td className="px-4 py-4 text-center tabular-nums"><span className="whitespace-nowrap">{isPast(row) ? `${row.checkedInSeats} / ${row.purchasedSeats} / ${row.maxSeats ?? "?"}` : `${row.remainingSeats ?? "?"} / ${row.maxSeats ?? "?"}`}</span></td><td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{row.ticketPrice === null || row.ticketPrice === "" ? "Noch offen" : Number(row.ticketPrice) === 0 ? "kostenlos" : `${row.ticketPrice.replace(".", ",")} ${row.currency}`}</td><td className="px-4 py-4 text-right tabular-nums">{row._count.bookings}</td><td className="px-4 py-4"><div className="flex items-start gap-2">{canManage && !editor && <DeleteEvent slug={company.slug} row={row} onDeleted={setMessage} />}</div></td></tr>; })())}</tbody></table>
   {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{query ? "Keine passenden Veranstaltungen gefunden." : "Keine Veranstaltungen in diesem Bereich."}</p>}
  </div>
  </details>;
 }
 return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-[28rem]" : ""}`}>
  {seriesDetails}
  {!seriesDetails && <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Veranstaltungen</h1><p className="text-sm text-zinc-500">{company.name}</p></div>{canManage && <Link href={`/company/${encodeURIComponent(company.slug)}/events/new`} className={primary}>+ Veranstaltung erstellen</Link>}</header>}
  {message && <p role="status" className="text-green-700 dark:text-green-300">{message}</p>}
  {canManage && editor && <EventForm key={editor.row?.id ?? "new"} slug={company.slug} row={editor.row} defaultSeries={series.find((item) => item.id === defaultSeriesId)} series={series} venues={venues} trainers={trainers} onCancel={() => setEditor(null)} onSaved={(text) => { setEditor(null); setMessage(text); }} />}
  {!seriesDetails && <div className="flex items-center justify-between gap-4 p-4"><label><span className="sr-only">Veranstaltungen durchsuchen</span><input type="search" placeholder="Veranstaltungen durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} className={input} /></label><span className="text-sm text-zinc-500">{filtered.length} von {events.length} Veranstaltungen</span></div>}
  {!seriesDetails && !events.length && <p className="text-sm text-zinc-500">Noch keine Veranstaltungen vorhanden.</p>}
  {renderSection(filtered.filter(row => !isPreviousDay(row)), "Heutige und zukünftige Veranstaltungen", sort, setSort)}
  {renderSection(filtered.filter(isPreviousDay), "Vergangene Veranstaltungen", pastSort, setPastSort, true)}
  {seriesNotes}
  {seriesHistory}
 </main>;
}
