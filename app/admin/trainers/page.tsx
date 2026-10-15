import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyTrainers, getTrainerCompanies } from "@/lib/trainers/data";
import { TrainersTable } from "@/app/company/[companyKey]/trainers/_components/trainers-table";

export default async function AdminTrainersPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company: slug } = await searchParams;
  let companies;
  let result;
  try {
    companies = await getTrainerCompanies();
    const selected = slug === undefined ? companies[0] : companies.find((company) => company.slug === slug);
    if (slug !== undefined && !selected) throw new MemberAccessError("NOT_FOUND");
    if (selected) result = await getCompanyTrainers(selected.slug);
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Trainer</h1><p role="alert" className="mt-4">Die Trainer konnten gerade nicht geladen werden.</p><a href="/admin/trainers" className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  if (!result) return <main className="flex-1 space-y-4 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Trainer</h1><p>Es ist noch keine Company für die Trainerverwaltung verfügbar.</p></main>;
  return <div className="flex min-w-0 flex-1 flex-col">
    <form action="/admin/trainers" className="flex flex-wrap items-end gap-3 px-6 pt-6 sm:px-10">
      <label className="text-sm">Company<select name="company" defaultValue={result.company.slug} className="ml-3 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">{companies.map((company) => <option key={company.id} value={company.slug}>{company.name}</option>)}</select></label>
      <button className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Anzeigen</button>
    </form>
    <TrainersTable key={result.company.id} {...result} />
  </div>;
}
