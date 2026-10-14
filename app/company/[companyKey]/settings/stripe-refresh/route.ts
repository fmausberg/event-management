import { redirect } from "next/navigation";
import { requireCompanyAdmin, MemberAccessError } from "@/lib/companies/members";
import { connectOnboarding } from "@/lib/payments/connect";
import { reportConnectError } from "@/lib/payments/connect-error";

export async function GET(_request: Request, { params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let url: string;
  try {
    const company = await requireCompanyAdmin(companyKey);
    url = await connectOnboarding(company.id);
  } catch (error) {
    if (error instanceof MemberAccessError) return new Response("Unauthorized", { status: 403 });
    redirect(`/company/${encodeURIComponent(companyKey)}/settings?stripe=${reportConnectError(error)}`);
  }
  redirect(url);
}
