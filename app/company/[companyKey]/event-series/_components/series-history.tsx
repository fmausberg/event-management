import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventSeriesHistory } from "@/lib/audit/history";

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
    <AuditTable entries={history.entries} />
    {(history.page > 1 || history.hasNext) && <nav aria-label="Seiten der Änderungshistorie" className="mt-4 flex items-center gap-4 text-xs">
      {history.page > 1 && <Link className="underline" href={href(history.page - 1)}>Neuere Einträge</Link>}
      <span>Seite {history.page}</span>
      {history.hasNext && <Link className="underline" href={href(history.page + 1)}>Ältere Einträge</Link>}
    </nav>}
  </section>;
}
