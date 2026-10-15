import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { getPublicEvents } from "@/lib/events/public-events";
import { PublicEvents, PublicHeader } from "@/components/public-events";

export const metadata = { title: "Veranstaltungen der Company" };

export default async function CompanyEventsPage({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams?: Promise<{ embed?: string | string[] }> }) {
  const { companySlug } = await params;
  const embedded = (await searchParams)?.embed === "1";
  const signedIn = !embedded && !!(await auth())?.user?.id;
  const container = embedded ? "bg-white text-zinc-900" : "min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900";
  let company;
  let events;
  try {
    company = await getPrisma().company.findUnique({ where: { slug: companySlug }, select: { name: true } });
    if (company) events = await getPublicEvents(companySlug);
  } catch {
    return <div className={container}>{!embedded && <PublicHeader signedIn={signedIn} />}<main className="mx-auto max-w-6xl px-8 py-12"><h1 className="text-3xl font-semibold">Events</h1><p role="alert" className="mt-6">Die Events konnten gerade nicht geladen werden.</p><Link href={`/events/${encodeURIComponent(companySlug)}${embedded ? "?embed=1" : ""}`} className="mt-4 inline-block text-primary-700 underline">Erneut versuchen</Link></main></div>;
  }
  if (!company) notFound();
  return <div className={container}>{!embedded && <PublicHeader signedIn={signedIn} />}<PublicEvents key={companySlug} events={events ?? []} companyName={company.name} embedded={embedded} /></div>;
}
