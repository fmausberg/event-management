import Link from "next/link";
import { requireImportPageAccess } from "../import/page-access";
import { getPrisma } from "@/lib/db/prisma";

export default async function ImportHistory({ params, searchParams }: {
  params: Promise<{ companyKey: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const { companyKey } = await params;
  const { company } = await requireImportPageAccess(companyKey);
  const page = Math.floor(Math.min(10000, Math.max(1, Number((await searchParams).page) || 1)));
  const runs = await getPrisma().bookingImport.findMany({ where: { companyId: company.id }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: 51, skip: (Math.floor(page)-1)*50, include: { createdBy: { select: { name: true, email: true } } } });
  const base = `/company/${encodeURIComponent(companyKey)}/bookings`;
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
  return <main className="min-w-0 flex-1 space-y-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">Importhistorie</h1><p className="text-sm text-zinc-500">{company.name} · Bestätigte Importläufe</p></div><div className="flex gap-4"><Link className="underline" href={base}>Buchungen</Link><Link className="underline" href={`${base}/import`}>Buchungen importieren</Link></div></header>
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"><table className="w-full text-left text-sm"><caption className="sr-only">Importläufe der Company</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Import / Quelle", "Abgeschlossen", "Erstellt von", "Zeilen", "Importiert", "Duplikate", "Ausgeschlossen", "Fehler"].map(h => <th key={h} scope="col" className="p-4">{h}</th>)}</tr></thead><tbody>{runs.slice(0,50).map(run => <tr key={run.id} className="border-t border-zinc-200 dark:border-zinc-800"><th scope="row" className="p-4"><Link className="underline" href={`${base}/imports/${run.id}`}>{run.name}</Link><p className="font-normal text-zinc-500">{run.platform}{run.rawDeletedAt ? " · Importdaten gelöscht" : ""}</p></th><td className="p-4">{date.format(run.completedAt)}</td><td className="p-4">{run.createdBy.name ?? run.createdBy.email}</td>{[run.rowCount,run.importedCount,run.duplicateCount,run.excludedCount,run.errorCount].map((n,i) => <td key={i} className="p-4">{n}</td>)}</tr>)}</tbody></table>{!runs.length && <p className="p-8 text-center text-zinc-500">Noch keine bestätigten Importe vorhanden.</p>}</div>
    <nav aria-label="Seiten" className="flex gap-4">{page > 1 && <Link className="underline" href={`${base}/imports?page=${page-1}`}>Vorherige</Link>}<span>Seite {page}</span>{runs.length > 50 && <Link className="underline" href={`${base}/imports?page=${page+1}`}>Nächste</Link>}</nav>
  </main>;
}
