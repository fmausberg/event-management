import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyEvents } from "@/lib/company-events/data";
import { EventDetails } from "../_components/event-details";
import { EventBookings } from "../_components/event-bookings";
import { EventTickets } from "../_components/event-tickets";
import { EventReviews } from "../_components/event-reviews";
import { EventHistory } from "../_components/event-history";

export default async function CompanyEventDetailPage({ params, searchParams }: { params: Promise<{ companyKey: string; eventId: string }>; searchParams?: Promise<{ historyPage?: string | string[] }> }) {
  const { companyKey, eventId } = await params;
  const query = await searchParams ?? {};
  const historyPage = typeof query.historyPage === "string" ? Number(query.historyPage) : 1;
  let result;
  try { result = await getCompanyEvents(companyKey, undefined, eventId); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Veranstaltung</h1><p role="alert" className="mt-4">Die Veranstaltung konnte gerade nicht geladen werden.</p><Link className="mt-4 inline-block underline" href={`/company/${encodeURIComponent(companyKey)}/events/${encodeURIComponent(eventId)}`}>Erneut versuchen</Link></main>;
  }
  const event = result.events.find(row => row.id === eventId);
  if (!event) notFound();
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <PageBreadcrumb label={event.name || "Unbenannter Entwurf"} />
    <EventDetails slug={result.company.slug} row={event} series={result.series} venues={result.venues} trainers={result.trainers} canManage={result.canManage}>
      <EventBookings slug={result.company.slug} eventId={event.id} />
      <EventTickets slug={result.company.slug} eventId={event.id} />
    </EventDetails>
    <EventReviews slug={result.company.slug} eventId={event.id} />
    <EventHistory slug={result.company.slug} eventId={event.id} page={historyPage} />
  </main>;
}
