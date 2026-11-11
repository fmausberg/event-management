"use client";
import { bookingSource } from "@/lib/bookings/source";



import { useState } from "react";

import Link from "next/link";

import type { getCompanyBookings } from "@/lib/bookings/company";

import { ObjectNotes, type NoteSummaries } from "@/components/object-notes";

import { ResendTicketEmail } from "@/components/resend-ticket-email";

import { BookingForm, RemoveBooking } from "../events/[eventId]/bookings/_components/bookings-table";



type Data = Awaited<ReturnType<typeof getCompanyBookings>>;

type Row = Data["bookings"][number];

const statuses = { CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" };

const statusColors = { CONFIRMED: "bg-green-100 text-green-800", CANCELLED: "bg-red-100 text-red-800", PENDING_PAYMENT: "bg-yellow-100 text-yellow-800", EXPIRED: "bg-zinc-200 text-zinc-700" };

const eventDateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });

const columns = [

  ["number", "Nr."], ["customerName", "Person"], ["event", "Event"],

  ["quantity", "Plätze"], ["paidAmount", "Gezahlt (Abweichung zum Listenpreis)"], ["status", "Status"],

  ["bookedAt", "Buchungsdatum"], ["platform", "Quelle"],

] as const;

type SortKey = typeof columns[number][0];

function sortValue(row: Row, key: SortKey) {

  if (key === "event") return row.event.name;

  if (key === "status") return statuses[row.status];

  if (key === "platform") return bookingSource(row);

  return row[key];

}



function BookingSection({ title, rows, company, noteSummaries }: { title: string; rows: Row[]; company: Data["company"]; noteSummaries: NoteSummaries }) {

  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "bookedAt", ascending: false });

  const [editor, setEditor] = useState<Row | null>(null);

  const [message, setMessage] = useState("");

  const sorted = [...rows].sort((a, b) => {

    const left = sortValue(a, sort.key), right = sortValue(b, sort.key);

    const result = left == null ? (right == null ? 0 : 1) : right == null ? -1 : typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "de", { numeric: true, sensitivity: "base" });

    return (sort.ascending ? result : -result) || a.id.localeCompare(b.id);

  });

  return <section className="min-w-0 space-y-4">

    <h2 className="text-xl font-semibold">{title} ({rows.length})</h2>

    {message && <p role="status" className="text-green-700 dark:text-green-300">{message}</p>}

    {editor && <BookingForm modal slug={company.slug} eventId={editor.event.id} row={editor} onCancel={() => setEditor(null)} onSaved={text => { setEditor(null); setMessage(text); }} />}

    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">

      <table className="w-full text-left text-sm">

        <caption className="sr-only">{title} für {company.name}</caption>

        <thead className="bg-zinc-100 dark:bg-zinc-900"><tr>

          {columns.map(([key, label]) => <th key={key} scope="col" aria-sort={sort.key === key ? sort.ascending ? "ascending" : "descending" : "none"} className="px-4 py-3"><button type="button" className="text-left hover:underline focus-visible:outline-2" onClick={() => setSort({ key, ascending: sort.key === key ? !sort.ascending : true })}>{label} <span aria-hidden="true">{sort.key === key ? sort.ascending ? "↑" : "↓" : "↕"}</span></button></th>)}

          <th scope="col" className="px-4 py-3">Aktionen</th>

        </tr></thead>

        <tbody>{sorted.map(row => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">

          <td className="px-4 py-4">{row.number}</td>

          <th scope="row" className="max-w-64 px-4 py-4 font-medium"><p className="break-words">{row.customerName || "—"}</p><p className="break-all text-xs font-normal text-zinc-500 dark:text-zinc-400">{row.customerEmail || "—"}</p></th>

          <td className="px-4 py-4"><Link className="underline" href={`/company/${encodeURIComponent(company.slug)}/events/${encodeURIComponent(row.event.id)}`}>{row.event.name}</Link><p className="mt-1 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{row.event.beginsAt ? `${eventDateTime.format(new Date(row.event.beginsAt))} Uhr` : "Termin noch offen"}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{row.event.venueName ?? "Location noch offen"}</p></td>

          <td className="px-4 py-4">{row.quantity}</td>

          <td className="whitespace-nowrap px-4 py-4 tabular-nums">{row.paymentSummary}</td>

          <td className="px-4 py-4"><p className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusColors[row.status]}`}>{statuses[row.status]}</p></td>

          <td className="whitespace-nowrap px-4 py-4">{new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(row.bookedAt))}</td>

          <td className="px-4 py-4">{bookingSource(row)}{row.externalBookingId && <p className="text-xs text-zinc-500">{row.externalBookingId}</p>}</td>

          <td className="px-4 py-4"><div className="flex flex-wrap gap-3">

            {noteSummaries.counts[row.id] !== undefined && <ObjectNotes mode="dialog" target={{ type: "booking", id: row.id }} label={`Buchung #${row.number} - ${row.customerName || row.event.name}`} userId={noteSummaries.userId} initialCount={noteSummaries.counts[row.id]} />}

            <ResendTicketEmail companySlug={company.slug} eventId={row.event.id} bookingId={row.id} unavailableReason={row.resendUnavailableReason} />

            {!row.price && !row.payment && <>

              <button type="button" disabled={!!editor} className="underline disabled:opacity-40" onClick={() => { setEditor(row); setMessage(""); }}>Bearbeiten</button>

              {!editor && <RemoveBooking slug={company.slug} eventId={row.event.id} row={row} onDeleted={setMessage} />}

            </>}

          </div></td>

        </tr>)}</tbody>

      </table>

      {!rows.length && <p className="p-8 text-center text-sm text-zinc-500">Keine Buchungen vorhanden.</p>}

    </div>

  </section>;

}



export function CompanyBookings({ company, bookings, noteSummaries, now }: Data & { noteSummaries: NoteSummaries; now: number }) {

  const [query, setQuery] = useState("");

  const visible = bookings.filter(row => [row.number, row.customerName, row.customerEmail, row.event.name, bookingSource(row), row.externalBookingId].join(" ").toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));

  const past = (row: Row) => row.event.endsAt !== null && new Date(row.event.endsAt).getTime() <= now;

  return <main className="flex min-w-0 flex-1 flex-col gap-8 bg-zinc-50 p-6 sm:p-10 dark:bg-black">

    <header><h1 className="text-2xl font-semibold">Buchungen</h1><p className="text-sm text-zinc-500">{company.name} · Alle Buchungen der Company</p></header>

    <label className="max-w-md">Buchungen durchsuchen<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, E-Mail, Event oder Buchungsnummer …" className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>

    <BookingSection title="Aktuelle Buchungen" rows={visible.filter(row => !past(row))} company={company} noteSummaries={noteSummaries} />

    <BookingSection title="Vergangene Buchungen" rows={visible.filter(past)} company={company} noteSummaries={noteSummaries} />

  </main>;

}

