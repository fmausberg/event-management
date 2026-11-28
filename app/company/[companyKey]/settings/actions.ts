"use server";
import { withSessionAudit } from "@/lib/audit/session";
import { redirect } from "next/navigation";
import { requireCompanyAdmin, MemberAccessError } from "@/lib/companies/members";
import { connectOnboarding } from "@/lib/payments/connect";
import { reportConnectError } from "@/lib/payments/connect-error";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db/prisma";
import { companyBillingSchema, companyBillingSelect, type CompanyBillingState, type CompanyBillingValues } from "@/lib/companies/billing";

export async function saveCompanyBilling(slug: string, _previous: CompanyBillingState, form: FormData): Promise<CompanyBillingState> {
  return withSessionAudit("company/[companyKey]/settings.saveCompanyBilling", async () => {
    const values = Object.fromEntries(Object.keys(companyBillingSelect).map(key => {
      const value = form.get(key);
      if (key === "isSmallBusiness") return [key, value === "on"];
      return [key, typeof value === "string" ? value : ""];
    })) as CompanyBillingValues;
    let saved: CompanyBillingValues;
    try {
      const company = await requireCompanyAdmin(slug);
      const parsed = companyBillingSchema.safeParse(values);
      if (!parsed.success) return { values, errors: parsed.error.flatten().fieldErrors, message: "Bitte korrigiere die markierten Felder." };
      const data = {
        legalName: parsed.data.legalName || null,
        isSmallBusiness: parsed.data.isSmallBusiness,
        addressLine1: parsed.data.addressLine1 || null,
        addressLine2: parsed.data.addressLine2 || null,
        postalCode: parsed.data.postalCode || null,
        city: parsed.data.city || null,
        countryCode: parsed.data.countryCode || null,
        taxNumber: parsed.data.taxNumber || null,
        vatId: parsed.data.vatId || null,
        billingEmail: parsed.data.billingEmail || null,
      };
      await getPrisma().company.update({ where: { id: company.id }, data, select: { id: true } });
      saved = parsed.data;
    } catch (error) {
      return { values, message: error instanceof MemberAccessError ? error.message : "Die Stammdaten konnten nicht gespeichert werden. Bitte versuche es erneut." };
    }
    revalidatePath(`/company/${encodeURIComponent(slug)}`, "layout");
    return { success: true, values: saved, message: "Rechnungsstammdaten wurden gespeichert." };
  });
}

export async function startStripeOnboarding(slug: string, form: FormData) {
  return withSessionAudit("company/[companyKey]/settings.startStripeOnboarding", async () => {
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

  });
}
