import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { AdminAccessError } from "@/lib/auth/require-admin";
import { getAdminAuditHistory } from "@/lib/audit/history";

export const metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage({ searchParams }: { searchParams?: Promise<{ page?: string | string[] }> }) {
  const query = await searchParams ?? {};
  const page = typeof query.page === "string" ? Number(query.page) : 1;
  let history;
  try { history = await getAdminAuditHistory(page); }
  catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Audit</h1><p role="alert" className="mt-4">Die Audit-Einträge konnten gerade nicht geladen werden.</p><Link href="/admin/audit" className="mt-4 inline-block underline">Erneut versuchen</Link></main>;
  }
  return <main className="flex-1 space-y-6 p-6 sm:p-10">
    <h1 className="text-2xl font-semibold">Audit</h1>
    <section aria-label="Audit-Einträge" className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
      <AuditTable entries={history.entries} showTarget />
      {(history.page > 1 || history.hasNext) && <nav aria-label="Seiten der Audit-Einträge" className="mt-4 flex items-center gap-4 text-xs">
        {history.page > 1 && <Link className="underline" href={`/admin/audit?page=${history.page - 1}`}>Neuere Einträge</Link>}
        <span>Seite {history.page}</span>
        {history.hasNext && <Link className="underline" href={`/admin/audit?page=${history.page + 1}`}>Ältere Einträge</Link>}
      </nav>}
    </section>
  </main>;
}
