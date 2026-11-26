"use client";
import { useActionState } from "react";
import { syncEventbriteBookings } from "../eventbrite-actions";
import type { EventbriteBookingImportState, EventbriteBookingImportSummary } from "@/lib/eventbrite/booking-import-state";

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });

export function EventbriteBookingImport({ slug, eventId, summaries, disabled = false }: {
  slug: string; eventId: string; summaries: EventbriteBookingImportSummary[]; disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<EventbriteBookingImportState>(syncEventbriteBookings.bind(null, slug, eventId), {});
  if (!summaries.length) return null;
  const summary = summaries[0];
  return <section aria-label="Eventbrite-Buchungsimport" className="space-y-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button disabled={disabled || pending || summaries.length !== 1 || summary.running} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50">{pending ? "Buchungen werden synchronisiert …" : "Eventbrite-Buchungen synchronisieren"}</button>
      <p role="status" className="text-zinc-500">Letzter erfolgreicher Import: {summary.lastImportedAt ? `${dateTime.format(new Date(summary.lastImportedAt))} Uhr` : "Noch kein Import"}</p>
    </form>
    {summaries.length !== 1 && <p role="alert">Mehrere Eventbrite-Zuordnungen vorhanden. Bitte einen Plattformadministrator kontaktieren.</p>}
    {summary.running && <p role="status">Für dieses Event läuft bereits ein Import. Bitte die Seite später aktualisieren.</p>}
    {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>{state.message}</p>}
    {!state.message && summary.lastError && <p role="alert" className="text-red-700 dark:text-red-300">{summary.lastError}</p>}
    <p className="text-xs text-zinc-500">Übernimmt Buchungen und Stornierungen. Zahlungen und Tickets bleiben bei Eventbrite. Freie Plätze werden erst mit dem nächsten Import aktualisiert; dieser Button ändert kein Kontingent bei Eventbrite.</p>
  </section>;
}
