"use client";
import { useActionState } from "react";
import type { EventRow } from "@/lib/company-events/model";
import { retryEventbritePublication } from "../eventbrite-actions";

const labels: Record<string, string> = {
  PENDING: "Übertragung vorgemerkt", PROCESSING: "Wird übertragen", ERROR: "Übertragung fehlgeschlagen",
  UNCERTAIN: "Übertragung muss geprüft werden", PUBLISHED: "Auf Eventbrite veröffentlicht",
};

export function EventbritePublication({ slug, row }: { slug: string; row: EventRow }) {
  const [message, retry, pending] = useActionState(async () => {
    try { await retryEventbritePublication(slug, row.id); return "Der Auftrag wurde bearbeitet. Bitte den Status prüfen."; }
    catch { return "Der Auftrag konnte gerade nicht bearbeitet werden."; }
  }, "");
  if (!row.postToEventbrite && !row.eventbritePublication) return null;
  const publication = row.eventbritePublication;
  return <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 className="font-semibold">Eventbrite</h2>
    <p role="status" className="text-sm">{publication ? labels[publication.status] ?? "Status unbekannt" : "Wird nach der Veröffentlichung auf Eventbrite übertragen."}</p>
    {publication?.externalEventId && <p className="text-sm"><a href={`https://www.eventbrite.com/e/${encodeURIComponent(publication.externalEventId)}`} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline dark:text-primary-300">Eventbrite-Event öffnen</a><span className="ml-2 text-zinc-500">ID: {publication.externalEventId}</span></p>}
    {publication?.lastError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{publication.lastError}</p>}
    {publication?.status === "UNCERTAIN" && <p className="text-sm">Bitte den Auftrag durch einen Plattformadministrator mit Eventbrite abgleichen lassen. Ein erneuter Versand ist zum Schutz vor Duplikaten gesperrt.</p>}
    {publication?.status === "ERROR" && <form action={retry}><button disabled={pending} className="rounded-md bg-primary-700 px-4 py-2 text-sm text-white">{pending ? "Wird übertragen …" : "Übertragung erneut versuchen"}</button></form>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <p className="text-xs text-zinc-500">Eventbrite-Buchungen können im Bereich „Buchungen“ per Knopfdruck importiert werden. Tickets und Zahlungen bleiben bei Eventbrite; ein automatischer Kapazitätsabgleich findet nicht statt. Event-Änderungen und Absagen bitte auch direkt in Eventbrite durchführen.</p>
  </section>;
}
