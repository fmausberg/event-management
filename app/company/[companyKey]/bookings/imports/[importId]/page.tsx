import Link from "next/link";
import { notFound } from "next/navigation";
import { requireImportPageAccess } from "../../import/page-access";
import { getPrisma } from "@/lib/db/prisma";
import { EraseImportData } from "./erase-data";

const outcomes: Record<string,string> = { IMPORTED: "Importiert", DUPLICATE: "Als Duplikat übersprungen", EXCLUDED: "Ausgeschlossen", ERROR: "Mit Fehler abgelehnt (ausgeschlossen)" };
export default async function ImportDetail({ params, searchParams }: {
  params: Promise<{ companyKey: string; importId: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const { companyKey, importId } = await params;
  const { company, canManageMembers } = await requireImportPageAccess(companyKey);
  const page = Math.floor(Math.min(10000, Math.max(1, Number((await searchParams).page) || 1)));
  const run = await getPrisma().bookingImport.findFirst({ where: { id: importId, companyId: company.id }, include: {
    createdBy: { select: { name: true, email: true } },
    rows: { orderBy: { sourceRow: "asc" }, take: 50, skip: (page-1)*50, include: { event: { select: { name: true } }, booking: { select: { number: true } } } },
  } });
  if (!run) notFound();
  const base = `/company/${encodeURIComponent(companyKey)}/bookings`;
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
  const json = (value: unknown) => <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">{JSON.stringify(value,null,2)}</pre>;
  return <main className="min-w-0 flex-1 space-y-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">{run.name}</h1><p className="text-sm text-zinc-500">{company.name} · {run.platform} · {run.fileName} · {run.sheetName}</p></div><Link className="underline" href={`${base}/imports`}>Importhistorie</Link></header>
    <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"><h2 className="font-semibold">Import abgeschlossen</h2><p>Ersteller: {run.createdBy.name ?? run.createdBy.email}</p><p>Beginn: {date.format(run.startedAt)} · Abschluss: {date.format(run.completedAt)}</p><p>{run.rowCount} Quellzeilen · {run.importedCount} importiert · {run.duplicateCount} Duplikate · {run.excludedCount} ausgeschlossen · {run.errorCount} mit Fehler abgelehnt</p><p className="text-sm text-zinc-500">Externe Angaben; keine Stripe-Zahlungen, Steuerbelege oder internen Tickets. Erstattungen lösen keine internen Erstattungen aus. Abgelehnte und ausgeschlossene Zeilen erzeugen keine Buchung.</p></section>
    {run.rawDeletedAt ? <p role="status">Personenbezogene Importdaten wurden am {date.format(run.rawDeletedAt)} gelöscht. Buchungen, Preis-Snapshots und Ergebniszähler bleiben erhalten.</p> : <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><summary className="cursor-pointer font-medium">Angewendetes Spaltenmapping (für alle Zeilen)</summary>{json(run.mapping)}</details>}
    <section className="space-y-4" aria-label="Importzeilen">{run.rows.map(row => <article className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950" key={row.id}>
      <h2 className="font-semibold">Quellzeile {row.sourceRow} · {outcomes[row.outcome] ?? row.outcome}</h2>
      <p>Internes Event: {row.eventId ? <Link className="underline" href={`/company/${encodeURIComponent(companyKey)}/events/${encodeURIComponent(row.eventId)}`}>{row.event?.name} ({row.eventId})</Link> : "Nicht zugeordnet"}</p>
      {row.bookingId && <Link className="inline-block underline" href={`${base}?booking=${encodeURIComponent(row.bookingId)}`}>Buchung #{row.booking?.number} öffnen</Link>}
      {!!row.messages.length && <ul className="list-inside list-disc text-sm">{row.messages.map((m,i) => <li key={i}>{m}</li>)}</ul>}
      {!run.rawDeletedAt && <><details><summary className="cursor-pointer">Ursprüngliche Spalten und Zellwerte (einschließlich unzugeordneter Spalten)</summary>{json(row.raw)}</details><details><summary className="cursor-pointer">Angewendetes Mapping</summary>{json(run.mapping)}</details><details><summary className="cursor-pointer">Normalisierte Buchungswerte / externe Erstattungen</summary>{json(row.normalized)}</details></>}
    </article>)}</section>
    <nav aria-label="Zeilenseiten" className="flex gap-4">{page > 1 && <Link className="underline" href={`${base}/imports/${run.id}?page=${page-1}`}>Vorherige</Link>}<span>Seite {page} / {Math.max(1,Math.ceil(run.rowCount/50))}</span>{page*50 < run.rowCount && <Link className="underline" href={`${base}/imports/${run.id}?page=${page+1}`}>Nächste</Link>}</nav>
    {canManageMembers && !run.rawDeletedAt && <EraseImportData slug={companyKey} importId={run.id} />}
  </main>;
}
