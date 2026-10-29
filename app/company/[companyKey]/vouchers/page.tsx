import { notFound } from "next/navigation";
import { getVoucherAdministration } from "@/lib/vouchers/admin-data";
import { VoucherError } from "@/lib/vouchers/errors";
import { VoucherAdministrationView } from "@/components/voucher-admin-view";

export default async function VouchersPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let data;
  try { data = await getVoucherAdministration(companyKey); }
  catch (error) { if (error instanceof VoucherError && error.code === "FORBIDDEN") notFound(); return <main className="p-6"><h1>Gutscheine</h1><p role="alert">Die Gutscheinverwaltung ist derzeit nicht verfügbar.</p></main>; }
  return <VoucherAdministrationView data={data} />;
}
