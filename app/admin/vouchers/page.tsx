import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin, AdminAccessError } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";

export default async function AdminVouchersPage() {
  try { await requireAdmin(); }
  catch (error) { if (error instanceof AdminAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); } throw error; }
  const companies = await getPrisma().company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, _count: { select: { ownedVoucherCampaigns: true } } } });
  return <main className="min-w-0 flex-1 space-y-6 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Gutscheinverwaltung</h1><p>Company auswählen. Plattform-Admins verwalten Kampagnen über die zugehörige Company; Wertguthaben bleibt an deren Events gebunden.</p><ul className="grid gap-4 sm:grid-cols-2">{companies.map(company => <li key={company.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"><Link className="font-medium underline" href={`/company/${encodeURIComponent(company.slug)}/vouchers`}>{company.name}</Link><p className="text-sm text-zinc-500">{company._count.ownedVoucherCampaigns} Kampagnen</p></li>)}</ul></main>;
}
