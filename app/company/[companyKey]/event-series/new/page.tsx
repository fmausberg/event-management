import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanySeries } from "@/lib/event-series/data";
import { NewSeries } from "../_components/new-series";

export default async function NewEventSeriesPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanySeries(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Veranstaltungsreihe erstellen</h1><p role="alert" className="mt-4">Das Formular konnte gerade nicht geladen werden.</p><Link href={`/company/${encodeURIComponent(companyKey)}/event-series/new`} className="mt-4 inline-block underline">Erneut versuchen</Link></main>;
  }
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <PageBreadcrumb label="Neue Veranstaltungsreihe" />
    <h1 className="text-2xl font-semibold">Veranstaltungsreihe erstellen</h1>
    <NewSeries slug={result.company.slug} venues={result.venues} trainers={result.trainers} />
  </main>;
}
