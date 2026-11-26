"use client";
import Link from "next/link";
import { useState } from "react";
import type { VoucherAdministration } from "@/lib/vouchers/admin-data";
import { VoucherCampaignForm } from "./voucher-admin-forms";

const primary = "rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50";
const statuses: Record<string, string> = { DRAFT: "Entwurf", ACTIVE: "Aktiv", PAUSED: "Pausiert", ARCHIVED: "Archiviert" };
const statusColors: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  PAUSED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ARCHIVED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};
const kinds: Record<string, string> = { PERCENTAGE: "Prozent", FIXED_AMOUNT: "Festbetrag", STORED_VALUE: "Wertguthaben" };
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" }).format(value) : "Unbegrenzt";
const money = (minor: number) => `${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
function targetCount(row: VoucherAdministration["rows"][number]) { const c = row.campaign; return c.companyTargets.length + c.eventSeriesTargets.length + c.eventTargets.length + c.venueTargets.length; }
function StatusTag({ status }: { status: string }) { return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusColors[status] ?? statusColors.ARCHIVED}`}>{statuses[status] ?? status}</span>; }
export function VoucherCampaignsTable({ data, start }: { data: VoucherAdministration; start: string }) {
  const [editor, setEditor] = useState(false);
  const [message, setMessage] = useState("");
  const base = `/company/${encodeURIComponent(data.company.slug)}/vouchers`;
  function saved(value: string) { setEditor(false); setMessage(value); }
  return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-[32rem]" : ""}`}>
    <header className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Kampagnen</h1><button type="button" disabled={!!editor} aria-label="Neue Kampagne erstellen" onClick={() => { setEditor(true); setMessage(""); }} className={primary}>+ Kampagne</button></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    {editor && <VoucherCampaignForm slug={data.company.slug} options={data.options} start={start} drawer onSaved={saved} onCancel={() => setEditor(false)} />}
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm"><caption className="sr-only">Gutscheinkampagnen</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Nr.", "Kampagne", "Art und Wert", "Status", "Laufzeit", "Ziele", "Codes", "Nutzungen"].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{data.rows.map(row => { const c = row.campaign; return <tr key={c.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{c.number}</td><th scope="row" className="min-w-48 px-4 py-4 font-medium"><Link href={`${base}/${encodeURIComponent(c.id)}`} className="text-primary-700 underline dark:text-primary-300">{c.name}</Link>{c.source && <p className="mt-1 text-xs font-normal text-zinc-500">{c.source}</p>}</th><td className="whitespace-nowrap px-4 py-4">{kinds[c.kind]}<p className="text-xs text-zinc-500">{c.kind === "PERCENTAGE" ? `${(c.percentageBps ?? 0) / 100} %` : money(c.amountMinor ?? 0)}</p></td><td className="px-4 py-4"><StatusTag status={c.status} /></td><td className="whitespace-nowrap px-4 py-4">{date(c.startsAt)}<br /><span className="text-xs text-zinc-500">bis {date(c.endsAt)}</span></td><td className="px-4 py-4">{targetCount(row)}</td><td className="px-4 py-4">{c._count.codes}</td><td className="px-4 py-4">{row.stats.committed}<span className="text-xs text-zinc-500"> / {row.stats.reserved} reserviert</span></td></tr>; })}</tbody>
      </table>
      {!data.rows.length && <p className="p-8 text-center text-sm text-zinc-500">Noch keine Kampagnen vorhanden. Erstelle die erste Kampagne über den Button oben rechts.</p>}
    </div>
  </main>;
}
