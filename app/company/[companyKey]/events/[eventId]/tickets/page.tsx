import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventTickets } from "@/lib/tickets/management";
import { RedeemButton } from "./redeem-button";

export default async function TicketsPage({ params }: { params: Promise<{ companyKey: string; eventId: string }> }) {
 const { companyKey, eventId } = await params;
 let result;
 try { result = await getEventTickets(companyKey, eventId); }
 catch (error) {
  if (error instanceof MemberAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); }
  return <main className="flex-1 p-6"><h1 className="text-2xl font-semibold">Tickets</h1><p role="alert" className="mt-4">Die Tickets konnten gerade nicht geladen werden.</p><a className="mt-4 inline-block underline" href={`/company/${encodeURIComponent(companyKey)}/events/${encodeURIComponent(eventId)}/tickets`}>Erneut versuchen</a></main>;
 }
 const date = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
 return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
  <header><h1 className="text-2xl font-semibold">Tickets – {result.event.name}</h1><p className="mt-2 text-sm text-zinc-500">{result.company.name} · {result.event.beginsAt ? date.format(result.event.beginsAt) : "Noch offen"} Uhr (Berlin)</p><Link className="mt-3 inline-block text-sm underline" href="/account/events">Check-In Management</Link></header>
  <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"><table className="w-full text-left text-sm">
   <caption className="sr-only">Alle Tickets für {result.event.name}</caption>
   <thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Ticketnummer", "Buchungsnummer", "Name des Buchers", "E-Mail", "Status", "Einlösen"].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
   <tbody>{result.tickets.map((ticket) => {
    const cancelled = ticket.status === "CANCELLED" || ticket.booking.status === "CANCELLED" || result.event.status === "CANCELLED";
    const label = cancelled ? "Storniert" : ticket.checkedInAt ? `eingelöst ${date.format(ticket.checkedInAt)} Uhr (Berlin)` : "Gültig";
    return <tr key={ticket.id} className="border-t border-zinc-200 dark:border-zinc-800"><th scope="row" className="px-4 py-3 font-medium">#{ticket.number}</th><td className="px-4 py-3">#{ticket.booking.number}</td><td className="px-4 py-3">{ticket.booking.customerName || "—"}</td><td className="px-4 py-3">{ticket.booking.customerEmail || "—"}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${cancelled ? "bg-red-100 text-red-800" : ticket.checkedInAt ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}>{label}</span></td><td className="px-4 py-3">{ticket.checkedInAt ? <>eingelöst von {ticket.checkedInBy?.email ?? "unbekannt"}</> : !cancelled ? <RedeemButton slug={companyKey} eventId={eventId} ticketId={ticket.id} /> : "—"}</td></tr>;
   })}{!result.tickets.length && <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Noch keine Tickets vorhanden.</td></tr>}</tbody>
  </table></div>
 </main>;
}
