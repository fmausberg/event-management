import { notFound } from "next/navigation";
import { getVoucherAdministration } from "@/lib/vouchers/admin-data";
import { VoucherError } from "@/lib/vouchers/errors";
import { VoucherAdministrationView } from "@/components/voucher-admin-view";

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ companyKey: string; campaignId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { companyKey, campaignId } = await params;
  const page = Number((await searchParams).page ?? 1);
  let data;
  try { data = await getVoucherAdministration(companyKey, campaignId, page); }
  catch (error) { if (error instanceof VoucherError && ["FORBIDDEN", "INVALID_INPUT"].includes(error.code)) notFound(); return <main className="p-6"><h1>Gutscheinkampagne</h1><p role="alert">Die Kampagne konnte nicht geladen werden.</p></main>; }
  return <VoucherAdministrationView data={data} detail />;
}
