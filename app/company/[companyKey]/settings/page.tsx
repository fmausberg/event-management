import { notFound, redirect } from "next/navigation";
import { PlaceholderPage } from "@/components/placeholder-page";
import { MemberAccessError, requireCompanyAdmin } from "@/lib/companies/members";
export default async function CompanySettingsPage({ params }: { params: Promise<{ companyKey: string }> }) {
 const { companyKey } = await params;
 try { await requireCompanyAdmin(companyKey); }
 catch (error) {
  if (error instanceof MemberAccessError) {
   if (error.reason === "UNAUTHENTICATED") redirect("/login");
   notFound();
  }
  throw error;
 }
 return <PlaceholderPage title="Company-Stammdaten">Hier kannst du bald die Stammdaten dieser Company bearbeiten.</PlaceholderPage>;
}
