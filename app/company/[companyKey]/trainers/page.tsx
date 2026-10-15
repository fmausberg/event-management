import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyTrainers } from "@/lib/trainers/data";
import { TrainersTable } from "./_components/trainers-table";

export default async function CompanyTrainersPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanyTrainers(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Trainer</h1><p role="alert" className="mt-4">Die Trainer konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/trainers`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <TrainersTable {...result} />;
}
