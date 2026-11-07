import { TicketsTable } from "./tickets-table";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventTickets } from "@/lib/tickets/management";

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
  <header><h1 className="text-2xl font-semibold">Tickets – {result.event.name}</h1><p className="mt-2 text-sm text-zinc-500">{result.company.name} · {result.event.beginsAt ? date.format(result.event.beginsAt) : "Noch offen"} Uhr (Berlin)</p><Link className="mt-3 inline-block text-sm underline" href="/account/eventmanagement">Veranstaltungsverwaltung</Link></header>
  <TicketsTable result={result} />
 </main>;
}
