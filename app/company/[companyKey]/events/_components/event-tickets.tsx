import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getEventTickets } from "@/lib/tickets/management";
import { getNoteSummaries } from "@/lib/notes/service";
import { TicketsTable } from "../[eventId]/tickets/tickets-table";

export async function EventTickets({ slug, eventId }: { slug: string; eventId: string }) {
  let content;
  try {
    await requireCompanyAccess(slug);
    const result = await getEventTickets(slug, eventId, true);
    const noteSummaries = await getNoteSummaries("ticket", result.tickets.map(row => row.id));
    content = <TicketsTable result={result} noteSummaries={noteSummaries} />;
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    content = <p role="alert" className="text-sm">Die Tickets konnten gerade nicht geladen werden. <Link className="underline" href={`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}#event-tickets`}>Erneut versuchen</Link></p>;
  }
  return <details id="event-tickets" className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Tickets/Teilnehmer</summary>
    <div className="min-w-0 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">{content}</div>
  </details>;
}
