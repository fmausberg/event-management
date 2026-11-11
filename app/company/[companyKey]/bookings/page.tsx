import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyBookings } from "@/lib/bookings/company";
import { getNoteSummaries } from "@/lib/notes/service";
import { CompanyBookings } from "./table";

export default async function CompanyBookingsPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanyBookings(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6"><h1 className="text-2xl font-semibold">Buchungen</h1><p role="alert">Die Buchungen konnten gerade nicht geladen werden.</p><a className="underline" href={`/company/${encodeURIComponent(companyKey)}/bookings`}>Erneut versuchen</a></main>;
  }
  const noteSummaries = await getNoteSummaries("booking", result.bookings.map(row => row.id));
  return <CompanyBookings {...result} noteSummaries={noteSummaries} />;
}
