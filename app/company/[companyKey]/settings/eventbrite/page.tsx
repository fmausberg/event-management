import { redirect } from "next/navigation";
import { requireCompanyAdmin } from "@/lib/companies/members";
import { settingsPath } from "@/lib/eventbrite/connection";

export default async function EventbriteSettingsPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  await requireCompanyAdmin(companyKey);
  redirect(`${settingsPath(companyKey)}#eventbrite`);
}
