import { TaxConfiguration } from "@/components/tax-configuration";
import { SeriesDetails } from "../_components/series-details";
import { ObjectNotesSection } from "@/components/object-notes-section";
import Link from "next/link";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyEvents } from "@/lib/company-events/data";
import { EventsTable } from "../../events/_components/events-table";
import { SeriesHistory } from "../_components/series-history";

export default async function CompanyEventSeriesDetailPage({ params, searchParams }: {
  params: Promise<{ companyKey: string; seriesId: string }>;
  searchParams?: Promise<{ historyPage?: string | string[] }>;
}) {
  const { companyKey, seriesId } = await params;
  const query = await searchParams ?? {};
  const historyPage = typeof query.historyPage === "string" ? Number(query.historyPage) : 1;
  let result;
  try {
    result = await getCompanyEvents(companyKey, seriesId);
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">Veranstaltungsreihe</h1>
      <p role="alert" className="mt-4">Die Veranstaltungsreihe konnte gerade nicht geladen werden.</p>
      <Link href={`/company/${encodeURIComponent(companyKey)}/event-series/${encodeURIComponent(seriesId)}`} className="mt-4 inline-block underline">Erneut versuchen</Link>
    </main>;
  }
  const series = result.series.find((row) => row.id === seriesId);
  if (!series) notFound();
  return <EventsTable {...result} defaultSeriesId={series.id} seriesTaxes={<TaxConfiguration slug={companyKey} kind="series" id={series.id} collapsible />} seriesNotes={<ObjectNotesSection target={{ type: "eventSeries", id: series.id }} label={series.name} />} seriesHistory={<SeriesHistory companyKey={companyKey} seriesId={series.id} page={historyPage} />} seriesDetails={<>
    <PageBreadcrumb label={series.name} />
    <SeriesDetails slug={companyKey} row={series} venues={result.venues} trainers={result.trainers} canManage={result.canManage} />
  </>} />;
}
