import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanySeries } from "@/lib/event-series/data";
import { SeriesTable } from "./_components/series-table";

export default async function CompanyEventSeriesPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanySeries(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Eventserien</h1><p role="alert" className="mt-4">Die Eventserien konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/event-series`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <SeriesTable {...result} />;
}
