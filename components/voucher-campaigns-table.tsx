"use client";
import Link from "next/link";
import { useState } from "react";
import type { Prisma } from "@prisma/client";
import type { VoucherAdministration } from "@/lib/vouchers/admin-data";
import { formatBerlinDateTime } from "@/lib/events/berlin-date-time";
import { VoucherCampaignForm, type CampaignFormValues } from "./voucher-admin-forms";

const primary = "rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50";
const statuses: Record<string, string> = { DRAFT: "Entwurf", ACTIVE: "Aktiv", PAUSED: "Pausiert", ARCHIVED: "Archiviert" };
const kinds: Record<string, string> = { PERCENTAGE: "Prozent", FIXED_AMOUNT: "Festbetrag", STORED_VALUE: "Wertguthaben" };
const date = (value: Date | null) => value ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium" }).format(value) : "Unbegrenzt";
const money = (minor: number) => `${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
function textField(value: Prisma.JsonValue | null, key: string) { return value && typeof value === "object" && !Array.isArray(value) && typeof value[key] === "string" ? value[key] as string : ""; }
function values(row: VoucherAdministration["rows"][number]): CampaignFormValues {
  const c = row.campaign;
  return { id: c.id, name: c.name, description: textField(c.policy, "adminDescription"), kind: c.kind,
    value: ((c.percentageBps ?? c.amountMinor ?? 0) / 100).toFixed(2), startsAt: formatBerlinDateTime(c.startsAt), endsAt: c.endsAt ? formatBerlinDateTime(c.endsAt) : "",
    maxRedemptions: String(c.maxRedemptions ?? ""), maxRedemptionsPerCustomer: String(c.maxRedemptionsPerCustomer ?? ""), maxEligibleTicketsPerBooking: String(c.maxEligibleTicketsPerBooking ?? ""), source: c.source ?? "",
    companyIds: c.companyTargets.map(item => item.companyId), seriesIds: c.eventSeriesTargets.map(item => item.eventSeriesId), eventIds: c.eventTargets.map(item => item.eventId), venueIds: c.venueTargets.map(item => item.venueId),
    locked: !!(c._count.codes || c._count.redemptions || c._count.balanceUses), archived: c.status === "ARCHIVED" };
}
function targetCount(row: VoucherAdministration["rows"][number]) { const c = row.campaign; return c.companyTargets.length + c.eventSeriesTargets.length + c.eventTargets.length + c.venueTargets.length; }
export function VoucherCampaignsTable({ data, start }: { data: VoucherAdministration; start: string }) {
  const [editor, setEditor] = useState<{ row?: VoucherAdministration["rows"][number] } | null>(null);
  const [message, setMessage] = useState("");
  const base = `/company/${encodeURIComponent(data.company.slug)}/vouchers`;
  function saved(value: string) { setEditor(null); setMessage(value); }
  return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-[32rem]" : ""}`}>
    <header className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Kampagnen</h1><button type="button" disabled={!!editor} aria-label="Neue Kampagne erstellen" onClick={() => { setEditor({}); setMessage(""); }} className={primary}>+ Kampagne</button></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    {editor && <VoucherCampaignForm key={editor.row?.campaign.id ?? "new"} slug={data.company.slug} options={data.options} start={start} row={editor.row ? values(editor.row) : undefined} drawer onSaved={saved} onCancel={() => setEditor(null)} />}
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm"><caption className="sr-only">Gutscheinkampagnen</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Nr.", "Kampagne", "Art und Wert", "Status", "Laufzeit", "Ziele", "Codes", "Nutzungen", "Aktionen"].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{data.rows.map(row => { const c = row.campaign; return <tr key={c.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{c.number}</td><th scope="row" className="min-w-48 px-4 py-4 font-medium"><Link href={`${base}/${encodeURIComponent(c.id)}`} className="text-primary-700 underline dark:text-primary-300">{c.name}</Link>{c.source && <p className="mt-1 text-xs font-normal text-zinc-500">{c.source}</p>}</th><td className="whitespace-nowrap px-4 py-4">{kinds[c.kind]}<p className="text-xs text-zinc-500">{c.kind === "PERCENTAGE" ? `${(c.percentageBps ?? 0) / 100} %` : money(c.amountMinor ?? 0)}</p></td><td className="px-4 py-4">{statuses[c.status]}</td><td className="whitespace-nowrap px-4 py-4">{date(c.startsAt)}<br /><span className="text-xs text-zinc-500">bis {date(c.endsAt)}</span></td><td className="px-4 py-4">{targetCount(row)}</td><td className="px-4 py-4">{c._count.codes}</td><td className="px-4 py-4">{row.stats.committed}<span className="text-xs text-zinc-500"> / {row.stats.reserved} reserviert</span></td><td className="px-4 py-4"><button type="button" disabled={!!editor || c.status === "ARCHIVED"} title={c.status === "ARCHIVED" ? "Archivierte Kampagnen sind schreibgeschützt" : "Kampagne bearbeiten"} aria-label={`${c.name} bearbeiten`} onClick={() => { setEditor({ row }); setMessage(""); }} className="rounded-lg p-2 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5" /></svg></button></td></tr>; })}</tbody>
      </table>
      {!data.rows.length && <p className="p-8 text-center text-sm text-zinc-500">Noch keine Kampagnen vorhanden. Erstelle die erste Kampagne über den Button oben rechts.</p>}
    </div>
  </main>;
}
