import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyEvents } from "@/lib/company-events/data";
import { EventsTable } from "./_components/events-table";

export default async function CompanyEventsPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanyEvents(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Events</h1><p role="alert" className="mt-4">Die Events konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/events`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <EventsTable {...result} />;
}
