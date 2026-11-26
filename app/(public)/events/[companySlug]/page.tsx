import Link from "next/link";
import { countries } from "@/lib/taxes/countries";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { getPublicEvents } from "@/lib/events/public-events";
import { PublicEvents, PublicHeader } from "@/components/public-events";

export const metadata = { title: "Veranstaltungen der Company" };

export default async function CompanyEventsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams?: Promise<{ embed?: string | string[]; country?: string | string[] }> }) {
  const { companySlug } = await params;
  const query = await searchParams;
  const embedded = query?.embed === "1";
  const country = typeof query?.country === "string" ? query.country.trim().toUpperCase() : undefined;
  if (query?.country !== undefined && (!country || !countries.some(item => item.code === country))) notFound();
  const listingQuery = new URLSearchParams();
  if (embedded) listingQuery.set("embed", "1");
  if (country) listingQuery.set("country", country);
  const listingUrl = `/events/${encodeURIComponent(companySlug)}${listingQuery.size ? `?${listingQuery}` : ""}`;
  const signedIn = !embedded && !!(await auth())?.user?.id;
  const container = embedded ? "bg-white text-zinc-900" : "min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900";
  let company;
  let events;
  try {
    company = await getPrisma().company.findUnique({ where: { slug: companySlug }, select: { name: true } });
    if (company) events = await getPublicEvents(companySlug, country);
  } catch {
    return <div className={container}>{!embedded && <PublicHeader signedIn={signedIn} />}<main className="mx-auto max-w-6xl px-8 py-12"><h1 className="text-3xl font-semibold">Veranstaltungen</h1><p role="alert" className="mt-6">Die Veranstaltungen konnten gerade nicht geladen werden.</p><Link href={listingUrl} className="mt-4 inline-block text-primary-700 underline">Erneut versuchen</Link></main></div>;
  }
  if (!company) notFound();
  return <div className={container}>{!embedded && <PublicHeader signedIn={signedIn} />}<PublicEvents key={`${companySlug}:${country ?? "all"}`} events={events ?? []} companyName={company.name} embedded={embedded} /></div>;
}
