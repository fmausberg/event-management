import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventSeriesHistory } from "@/lib/audit/history";
import { eventSeriesAuditFields, eventSeriesPrivateFields } from "@/lib/audit/policy";

const actions = { CREATE: "Create", UPDATE: "Update", DELETE: "Delete" };
const actors = { USER: "Nutzer", SYSTEM: "System", ANONYMOUS: "Anonym", UNKNOWN: "Unbekannt" };
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "medium" });
const fieldLabels: Readonly<Record<string, string>> = { ...eventSeriesAuditFields, ...eventSeriesPrivateFields };
function changedAttributes(entry: { changedFields: string[]; redactedFields: string[] }) {
  return [...new Set([...entry.changedFields, ...entry.redactedFields])]
    .filter((field) => Object.hasOwn(fieldLabels, field))
    .map((field) => fieldLabels[field])
    .join(", ") || "Keine freigegebenen Attribute";
}
function allowedValues(value: Prisma.JsonValue) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([field]) => Object.hasOwn(eventSeriesAuditFields, field)));
}
function details(entry: { before: Prisma.JsonValue; after: Prisma.JsonValue; redactedFields: string[] }) {
  const notRecorded = entry.redactedFields.filter((field) => Object.hasOwn(eventSeriesPrivateFields, field) || Object.hasOwn(eventSeriesAuditFields, field));
  return JSON.stringify({ before: allowedValues(entry.before), after: allowedValues(entry.after), ...(notRecorded.length ? { valuesNotRecorded: notRecorded } : {}) }, null, 2);
}

export async function SeriesHistory({ companyKey, seriesId, page }: { companyKey: string; seriesId: string; page: number }) {
  let history;
  try { history = await getEventSeriesHistory(companyKey, seriesId, page); }
  catch (error) {
    // Authorization failures must retain the detail page's redirect/notFound behavior.
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <section aria-label="Änderungshistorie" className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
      <h2 className="font-medium">Änderungshistorie</h2><p role="status" className="mt-2">Die Änderungshistorie konnte gerade nicht geladen werden.</p>
    </section>;
  }
  if (!history) return null;
  const href = (page: number) => `/company/${encodeURIComponent(companyKey)}/event-series/${encodeURIComponent(seriesId)}?historyPage=${page}#series-history`;
  return <section id="series-history" aria-labelledby="series-history-title" className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
    <h2 id="series-history-title" className="font-medium">Änderungshistorie</h2>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Änderungen an dieser Veranstaltungsreihe</caption>
        <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800"><tr>
          <th scope="col" className="px-3 py-2 font-medium">Timestamp</th>
          <th scope="col" className="px-3 py-2 font-medium">Wer?</th>
          <th scope="col" className="px-3 py-2 font-medium">Was?</th>
          <th scope="col" className="px-3 py-2 font-medium">Details</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {history.entries.map((entry) => <tr key={entry.id} className="align-top">
            <td className="whitespace-nowrap px-3 py-3"><time dateTime={entry.occurredAt.toISOString()}>{dateTime.format(entry.occurredAt)}</time><span className="block text-xs text-zinc-400">Europe/Berlin</span></td>
            <td className="px-3 py-3 break-all">{entry.actorType === "USER" ? entry.actorEmail ?? `Nutzer nicht mehr verfügbar (${entry.actorUserId ?? "ohne ID"})` : actors[entry.actorType]}</td>
            <td className="px-3 py-3">{actions[entry.action]}</td>
            <td className="min-w-64 px-3 py-3">
              <details className="group max-w-2xl">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3 transition-transform group-open:rotate-90"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className="min-w-0 text-xs">{changedAttributes(entry)}<span className="sr-only"> – JSON auf- oder zuklappen</span></span>
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-200 bg-white/60 p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950/40">{details(entry)}</pre>
              </details>
            </td>
          </tr>)}
          {!history.entries.length && <tr><td colSpan={4} className="px-3 py-4">Noch keine Einträge auf dieser Seite.</td></tr>}
        </tbody>
      </table>
    </div>
    {(history.page > 1 || history.hasNext) && <nav aria-label="Seiten der Änderungshistorie" className="mt-4 flex items-center gap-4 text-xs">
      {history.page > 1 && <Link className="underline" href={href(history.page - 1)}>Neuere Einträge</Link>}
      <span>Seite {history.page}</span>
      {history.hasNext && <Link className="underline" href={href(history.page + 1)}>Ältere Einträge</Link>}
    </nav>}
  </section>;
}
