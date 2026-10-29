import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { VoucherAdministration } from "@/lib/vouchers/admin-data";
import { formatBerlinDateTime } from "@/lib/events/berlin-date-time";
import { VoucherIssueForm, VoucherStatusForm } from "./voucher-admin-forms";
import { VoucherCampaignsTable } from "./voucher-campaigns-table";

const money = (n: number) => `${(n / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
const date = (d: Date | null) => d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(d) : "Unbegrenzt";
const statuses: Record<string, string> = { DRAFT: "Entwurf", ACTIVE: "Aktiv", PAUSED: "Pausiert", ARCHIVED: "Archiviert", DISABLED: "Gesperrt", RESERVED: "Reserviert", COMMITTED: "Erfolgreich", REVERSED: "Rückabgewickelt", PARTIALLY_REVERSED: "Teilweise rückabgewickelt", RELEASED: "Freigegeben" };
function textField(value: Prisma.JsonValue | null, key: string) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof value[key] === "string" ? value[key] as string : "";
}
function Targets({ row, data }: { row: VoucherAdministration["rows"][number]; data: VoucherAdministration }) {
  const c = row.campaign;
  const names = [
    ...c.companyTargets.map(t => `Company: ${data.options.companies.find(o => o.id === t.companyId)?.name ?? t.companyId}`),
    ...c.eventSeriesTargets.map(t => `Reihe: ${data.options.series.find(o => o.id === t.eventSeriesId)?.name ?? t.eventSeriesId}`),
    ...c.eventTargets.map(t => `Event: ${data.options.events.find(o => o.id === t.eventId)?.name ?? t.eventId}`),
    ...c.venueTargets.map(t => `Venue: ${data.options.venues.find(o => o.id === t.venueId)?.name ?? t.venueId}`),
  ];
  return <p className="text-sm text-zinc-500">{names.length ? names.join(" · ODER · ") : "Keine Ziele – nirgendwo gültig"}</p>;
}
function Stats({ row }: { row: VoucherAdministration["rows"][number] }) {
  const { campaign: c, stats: s } = row;
  const cells = [["Codes", c._count.codes], ["Erfolgreich (nicht rückabgewickelt)", s.committed], ["Reserviert", s.reserved], ["Rückabgewickelt", s.reversed], ["Freigegeben", s.released], ["Verbleibendes Nutzungslimit", s.remaining ?? "Unbegrenzt"], ["Wirksamer Rabatt", money(s.discountMinor)]];
  if (c.kind === "STORED_VALUE") cells.push(["Ausgegeben", money(s.issuedMinor)], ["Verbraucht (brutto)", money(s.spentMinor)], ["Wiederhergestellt", money(s.restoredMinor)], ["Guthabensaldo", money(s.balanceMinor)], ["Reserviertes Guthaben", money(s.reservedMinor)], ["Verfügbares Guthaben¹", money(s.availableMinor)]);
  return <><dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{cells.map(([label, value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>{c.kind === "STORED_VALUE" && <p className="text-xs text-zinc-500">¹ Aktiv und nicht abgelaufen, abzüglich Reservierungen. Ziel-, Empfänger- und Nutzungslimits werden erst beim Einlösen geprüft.</p>}</>;
}
export function VoucherAdministrationView({ data, detail = false }: { data: VoucherAdministration; detail?: boolean }) {
  const base = `/company/${encodeURIComponent(data.company.slug)}/vouchers`;
  const row = data.rows[0], c = row?.campaign;
  const panel = "space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
  if (!detail) return <VoucherCampaignsTable data={data} start={formatBerlinDateTime(new Date())} />;
  if (!row || !c) return <main className="min-w-0 flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Kampagne nicht gefunden</h1></main>;
  return <main className="min-w-0 flex-1 space-y-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header><h1 className="text-2xl font-semibold">{c.name}</h1>
      <p className="mt-2 text-sm text-zinc-500">Ein Code pro Buchung · explizite Ziele · alle Zeitangaben in Europe/Berlin</p>
      <Link className="mt-2 inline-block underline" href={base}>Zur Kampagnenübersicht</Link>
    </header>
    <section className={panel}>
      <h2 className="text-xl font-semibold">Kampagne <span className="text-sm font-normal text-zinc-500">#{c.number} · {statuses[c.status]}</span></h2>
      <p>{c.kind === "PERCENTAGE" ? `${(c.percentageBps ?? 0) / 100} % Rabatt` : `${money(c.amountMinor ?? 0)} ${c.kind === "STORED_VALUE" ? "Ausgabewert je Gutschein" : "Rabatt"}`}</p>
      {c.kind === "STORED_VALUE" && c._count.codes > 0 && <p className="text-sm text-zinc-500">Ausgegebene Wertgutscheine können pausiert beziehungsweise gesperrt werden. Die endgültige Archivierung ist bis zur Festlegung einer Guthaben-Abschlussregel gesperrt.</p>}
      <p className="text-sm">{date(c.startsAt)} – {date(c.endsAt)}</p><Targets row={row} data={data} /><Stats row={row} />
      <VoucherStatusForm slug={data.company.slug} campaignId={c.id} status={c.status} />
    </section>
    <>
      {c.status !== "ARCHIVED" && <VoucherIssueForm slug={data.company.slug} campaignId={c.id} stored={c.kind === "STORED_VALUE"} requestId={randomUUID()} />}
      <section className={panel}><h2 className="text-lg font-semibold">Codes · {data.activeCodes} aktiv / {c._count.codes} erzeugt</h2>
        <p className="text-sm text-zinc-500">Endzeichen dienen nur zur Zuordnung. Ein archivierter Code kann nicht wieder aktiviert werden.</p>
        <div className="space-y-4">{data.codes.map(code => <article key={code.id} className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="font-medium">…{code.codeSuffix ?? "—"} · Referenz {code.id.slice(-8)} · {code.mode === "PUBLIC" ? "Öffentlich" : "Individuell"} · {statuses[code.status]}</p>
          <p className="text-sm">Erstellt: {date(code.createdAt)} · Code-Limit: {code.maxRedemptions ?? "Unbegrenzt"} · Quelle: {code.source ?? "—"} · Empfängerbindung: {code.assignedUserId ? "Ja" : "Nein"}</p>
          <p className="break-all text-xs text-zinc-500">Batch: {code.batchId ?? "—"}</p>
          {code.balance && <p className="text-sm">Ausgabe: {money(code.balance.initialAmountMinor)} · Saldo: {money(code.balance.balanceMinor)} · Reserviert: {money(code.balance.reservedMinor)} · Ablauf: {date(code.balance.expiresAt)} · {code.balance.status}</p>}
          <VoucherStatusForm slug={data.company.slug} campaignId={c.id} status={code.status} codeId={code.id} />
        </article>)}</div>{!data.codes.length && <p>Keine Codes auf dieser Seite.</p>}
      </section>
      <section className={panel}><h2 className="text-lg font-semibold">Einlösungs- und Guthabenhistorie</h2>
        <p className="text-sm text-zinc-500">Buchungsreferenzen sind auf deinen Verwaltungsbereich beschränkt. Kampagnenlimits werden über alle Codes gezählt.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Rabattcode-Einlösungen und Wertgutschein-Einsätze</caption><thead><tr>{["Buchung", "Zeitpunkt", "Code", "Status", "Rabatt / Guthabeneinsatz", "Wiederhergestellt", "Quelle"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{[...data.redemptions, ...data.uses].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(use => <tr key={use.id} className="border-t border-zinc-200 dark:border-zinc-800"><td className="p-2">#{use.booking.number}</td><td className="p-2">{date(use.createdAt)}</td><td className="p-2">…{use.code.codeSuffix} / {use.code.id.slice(-8)}</td><td className="p-2">{statuses[use.status]}</td><td className="p-2">{money("amountMinor" in use ? use.amountMinor : use.discountAmountMinor)}</td><td className="p-2">{"restoredMinor" in use ? money(use.restoredMinor) : "—"}</td><td className="p-2">{textField(use.sourceSnapshot, "code") || textField(use.sourceSnapshot, "campaign") || "—"}</td></tr>)}</tbody>
        </table></div>{!data.redemptions.length && !data.uses.length && <p>Keine Vorgänge auf dieser Seite.</p>}
      </section>
      <nav aria-label="Gutscheinhistorie blättern" className="flex gap-4 text-sm"><span>Seite {data.page} · bis zu 50 Einträge je Liste</span>{data.page > 1 && <Link className="underline" href={`${base}/${c.id}?page=${data.page - 1}`}>Zurück</Link>}{(data.codes.length === 50 || data.redemptions.length === 50 || data.uses.length === 50) && <Link className="underline" href={`${base}/${c.id}?page=${data.page + 1}`}>Weiter</Link>}</nav>
    </>
  </main>;
}
