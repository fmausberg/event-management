import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventHistory } from "@/lib/audit/history";

export async function EventHistory({ slug, eventId, page }: { slug: string; eventId: string; page: number }) {
  let history;
  let failed = false;
  try { history = await getEventHistory(slug, eventId, page); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    failed = true;
  }
  if (!history && !failed) return null;
  const href = (targetPage: number) => `/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}?historyPage=${targetPage}#event-history`;
  return <details id="event-history" open={page > 1} className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Änderungshistorie</summary>
    <div className="min-w-0 border-t border-zinc-200 p-4 text-sm sm:p-6 dark:border-zinc-800">
      {history ? <>
        <AuditTable entries={history.entries} />
        {(history.page > 1 || history.hasNext) && <nav aria-label="Seiten der Änderungshistorie" className="mt-4 flex items-center gap-4 text-xs">
          {history.page > 1 && <Link className="underline" href={href(history.page - 1)}>Neuere Einträge</Link>}
          <span>Seite {history.page}</span>
          {history.hasNext && <Link className="underline" href={href(history.page + 1)}>Ältere Einträge</Link>}
        </nav>}
      </> : <p role="status">Die Änderungshistorie konnte gerade nicht geladen werden. <Link className="underline" href={href(page)}>Erneut versuchen</Link></p>}
    </div>
  </details>;
}
