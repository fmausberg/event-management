import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyVenues } from "@/lib/venues/data";
import { VenuesTable } from "./_components/venues-table";

export default async function CompanyVenuesPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanyVenues(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Venues</h1><p role="alert" className="mt-4">Die Venues konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/venues`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <VenuesTable {...result} />;
}
