import Link from "next/link";
import { Platform } from "@prisma/client";
import { requireImportPageAccess } from "./page-access";
import { ImportWizard } from "./wizard";

export default async function ImportPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  const { company } = await requireImportPageAccess(companyKey);
  return <main className="min-w-0 flex-1 space-y-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Buchungen importieren</h1><p className="text-sm text-zinc-500">{company.name} · Externe Verkäufe</p></div><Link className="underline" href={`/company/${encodeURIComponent(companyKey)}/bookings`}>Zurück zu Buchungen</Link></header>
    <ImportWizard slug={companyKey} platforms={Object.values(Platform)} />
  </main>;
}
