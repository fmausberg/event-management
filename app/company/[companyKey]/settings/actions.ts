"use server";
import { redirect } from "next/navigation";
import { requireCompanyAdmin, MemberAccessError } from "@/lib/companies/members";
import { connectOnboarding } from "@/lib/payments/connect";
import { reportConnectError } from "@/lib/payments/connect-error";

export async function startStripeOnboarding(slug: string, form: FormData) {
  let url: string;
  try {
    const company = await requireCompanyAdmin(slug);
    const country = form.get("country");
    url = await connectOnboarding(company.id, typeof country === "string" ? country.trim().toUpperCase() : undefined);
  } catch (error) {
    if (error instanceof MemberAccessError) throw error;
    redirect(`/company/${encodeURIComponent(slug)}/settings?stripe=${reportConnectError(error)}`);
  }
  redirect(url);
}
