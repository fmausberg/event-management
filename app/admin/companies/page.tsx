import { notFound, redirect } from "next/navigation";
import { AdminAccessError } from "@/lib/auth/require-admin";
import { getCompaniesForAdmin } from "@/lib/companies/get-companies";
import { CompaniesTable } from "./_components/companies-table";

export const metadata = { title: "Eventverwaltung" };

export default async function AdminCompaniesPage() {
  let companies;
  try {
    companies = await getCompaniesForAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Companies</h1><p role="alert" className="mt-4">Die Companies konnten gerade nicht geladen werden.</p><a href="/admin/companies" className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <CompaniesTable companies={companies} />;
}
