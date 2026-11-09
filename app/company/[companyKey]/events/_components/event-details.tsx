"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DescriptionHtml } from "@/components/description-html";
import { descriptionToText, isDescriptionEmpty } from "@/lib/descriptions/html";
import { cancellationPolicyText } from "@/lib/cancellations/policy";
import type { EventRow } from "@/lib/company-events/model";
import type { SeriesRow, VenueOption } from "@/lib/event-series/validation";
import type { TrainerOption } from "@/lib/trainers/validation";
import { EventForm, StatusTag, TrainerReminderControls } from "./events-table";
import { EventStaff } from "./event-staff";

const panelClass = "relative rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
const summaryClass = "cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600";
const contentClass = "min-w-0 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800";
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const headingDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "Europe/Berlin" });

export function EventDetails({ slug, row, series, venues, trainers, canManage, children }: {
  slug: string; row: EventRow; series: SeriesRow[]; venues: VenueOption[]; trainers: TrainerOption[]; canManage: boolean; children?: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const [message, setMessage] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const base = `/company/${encodeURIComponent(slug)}/events`;
  function closeEditor() { setEditing(false); setBusy(false); requestAnimationFrame(() => editButton.current?.focus()); }
  const eventSeries = series.find(item => item.id === row.eventSeriesId);
  const attributes = [
    ["Name", row.name || "Unbenannter Entwurf"], ["Kurzbeschreibung", row.shortdescription || "—"],
    ["Beginn", row.beginsAt ? date.format(new Date(row.beginsAt)) : "Noch offen"],
    ["Ende", row.endsAt ? date.format(new Date(row.endsAt)) : "Noch offen"],
    ["Teilnehmerzahl", row.maxSeats ?? "Noch offen"],
    ["Ticketpreis", row.ticketPrice === "" ? "Noch offen" : `${row.ticketPrice.replace(".", ",")} ${row.currency}`],
    ["Ort", venues.find(item => item.id === row.venueId)?.name ?? "—"],
    ["Trainer", row.trainerIds.map(id => { const trainer = trainers.find(item => item.id === id); return trainer ? `${trainer.firstName} ${trainer.lastName}` : "Trainer nicht mehr verfügbar"; }).join(", ") || row.trainerName || "—"],
    ["Kostenfreie Stornofrist (optional)", cancellationPolicyText(row.freeCancellationUntilMinutesBeforeStart ? Number(row.freeCancellationUntilMinutesBeforeStart) : null)],
  ];
  return <>
    <header><h1 className="text-2xl font-semibold">{row.name || "Unbenannter Entwurf"} <span className="font-normal text-zinc-500">(#{row.number} · {row.beginsAt ? `${weekday.format(new Date(row.beginsAt)).replace(".", "")} ${headingDate.format(new Date(row.beginsAt))} Uhr` : "Beginn noch offen"})</span></h1></header>
    <nav aria-label="Veranstaltungsverwaltung" className="flex flex-wrap gap-4 text-sm text-primary-700 dark:text-primary-300"><Link href={`${base}/${encodeURIComponent(row.id)}/tickets`} className="underline">Check-in Management</Link></nav>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    <details ref={details} open className={panelClass}>
      <summary className={`${summaryClass} pr-28`}>Details
        {canManage && (editing ? <span className="absolute right-3 top-2 flex gap-1">
          <button type="submit" form={formId} name="intent" value={row.status === "DRAFT" ? "draft" : "save"} disabled={busy} aria-label={busy ? "Speichern wird verarbeitet" : "Änderungen speichern"} title="Änderungen speichern" onClick={event => event.stopPropagation()} className="rounded-lg p-3 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></svg></button>
          <button type="button" disabled={busy} aria-label="Änderungen verwerfen" title="Änderungen verwerfen" onClick={event => { event.preventDefault(); event.stopPropagation(); closeEditor(); }} className="rounded-lg p-3 text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:hover:bg-zinc-800"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </span> : <button ref={editButton} type="button" aria-label="Details bearbeiten" title="Details bearbeiten" onClick={event => { event.preventDefault(); event.stopPropagation(); if (details.current) details.current.open = true; setMessage(""); setEditing(true); }} className="absolute right-3 top-2 rounded-lg p-3 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5" /></svg></button>)}
      </summary>
      <div className={contentClass}>{editing ? <EventForm inline formId={formId} onBusyChange={setBusy} slug={slug} row={row} series={series} venues={venues} trainers={trainers} onCancel={closeEditor} onSaved={text => { closeEditor(); setMessage(text); router.refresh(); }} /> : <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-sm text-zinc-500">Veranstaltungsreihe</dt><dd className="mt-1 min-h-11 border border-transparent px-3 py-2 text-sm">{eventSeries ? <Link className="text-primary-700 underline dark:text-primary-300" href={`/company/${encodeURIComponent(slug)}/event-series/${encodeURIComponent(eventSeries.id)}`}>{eventSeries.name}</Link> : "Keine Veranstaltungsreihe"}</dd></div>
          {attributes.map(([label, value]) => <div key={label} className={`min-w-0 ${label === "Trainer" ? "min-h-32" : label === "Kostenfreie Stornofrist (optional)" ? "min-h-40" : ""}`}><dt className="text-sm text-zinc-500">{label}</dt><dd className="mt-1 min-h-11 whitespace-pre-wrap break-words border border-transparent px-3 py-2 text-sm">{value}</dd></div>)}
          <div className="min-w-0"><dt className="text-sm text-zinc-500">Status</dt><dd className="mt-1 min-h-11 border border-transparent px-3 py-2 text-sm"><StatusTag status={row.status} /></dd></div>
          <div className="min-w-0 sm:col-span-2"><dt className="text-sm text-zinc-500">Beschreibung</dt><dd className="mt-1 break-words">{isDescriptionEmpty(row.description) ? "—" : <>
            <div id={descriptionId}>{descriptionExpanded ? <DescriptionHtml html={row.description} /> : <p className="line-clamp-2 whitespace-pre-line text-sm">{descriptionToText(row.description)}</p>}</div>
            <button type="button" aria-expanded={descriptionExpanded} aria-controls={descriptionId} onClick={() => setDescriptionExpanded(value => !value)} className="mt-2 rounded text-sm text-primary-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-primary-300">{descriptionExpanded ? "Weniger anzeigen" : "Mehr anzeigen"}</button>
          </>}</dd></div>
        </dl>
        <div className="min-w-0"><p className="mb-1 text-sm text-zinc-500">Titelbild</p>{row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageUrl} alt={`Titelbild: ${row.name}`} className="aspect-video w-full rounded-lg object-cover" />
        ) : <p className="text-sm text-zinc-500">Kein Titelbild</p>}</div>
      </div>}</div>
    </details>
    {children}
    {canManage && <>
      <details className={panelClass}><summary className={summaryClass}>Veranstaltungsteam</summary><div className={`${contentClass} overflow-x-auto`}><EventStaff embedded slug={slug} eventId={row.id} /></div></details>
      <details className={panelClass}><summary className={summaryClass}>Trainer-Info</summary><div className={contentClass}><TrainerReminderControls key={row.trainerReminderSentAt ?? "unsent"} embedded slug={slug} row={row} /></div></details>
    </>}
  </>;
}
