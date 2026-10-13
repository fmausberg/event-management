import { auth } from "@/auth";
import Link from "next/link";
import { getPublicEvents } from "@/lib/events/public-events";
import { PublicEvents, PublicHeader } from "@/components/public-events";
export const metadata = { title: "Eventverwaltung" };
export default async function PublicEventsPage() {
 const signedIn = !!(await auth())?.user?.id;
 let events;
 try { events = await getPublicEvents(); }
 catch { return <div className="min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900"><PublicHeader signedIn={signedIn} /><main className="mx-auto max-w-6xl px-8 py-12"><h1 className="text-3xl font-semibold">Events</h1><p role="alert" className="mt-6">Die Events konnten gerade nicht geladen werden.</p><Link href="/events" className="mt-4 inline-block text-primary-700 underline">Erneut versuchen</Link></main></div>; }
 return <div className="min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900"><PublicHeader signedIn={signedIn} /><PublicEvents events={events} /></div>;
}
