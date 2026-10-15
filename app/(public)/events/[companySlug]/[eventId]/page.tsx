import { auth } from "@/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicHeader } from "@/components/public-events";
import { PublicBookingForm } from "@/components/public-booking-form";
import { getBookableEvent } from "@/lib/bookings/public-event";
import { createBookingToken } from "@/lib/bookings/public-token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Eventverwaltung" };
export default async function EventDetailsPage({ params }: { params: Promise<{ companySlug: string; eventId: string }> }) {
    const session = await auth();
    const signedIn = !!session?.user?.id;
    const { companySlug, eventId } = await params;
    let event;
    let token = "";
    try {
        event = await getBookableEvent(companySlug, eventId);
        if (event && event.available > 0 && event.beginsAt > new Date()) token = createBookingToken(event.id, event.ticketPrice, event.currency);
    } catch {
        return <div className="min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900"><PublicHeader signedIn={signedIn} /><main className="mx-auto max-w-6xl p-8"><h1 className="text-2xl font-semibold">Eventdetails</h1><p role="alert" className="mt-4">Das Event konnte gerade nicht geladen werden. Bitte lade die Seite erneut.</p></main></div>;
    }
    if (!event) notFound();
    const date = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
    const image = event.imageUrl;
    return <div className="min-h-dvh border-t-[3px] border-primary-600 bg-white text-zinc-900"><PublicHeader signedIn={signedIn} />
        <main className="mx-auto max-w-6xl px-5 pb-16 pt-4 sm:px-8"><Link href="/events" className="text-sm text-primary-700 hover:underline">← Alle Events</Link>
            <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
                <article>
                    {image && /^https?:\/\//i.test(image) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image} alt="" referrerPolicy="no-referrer" className="mb-6 aspect-video w-full rounded-xl bg-primary-50 object-cover" />
                    )}
                    <p className="text-sm font-medium text-primary-700">{event.company.name}</p><h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{event.name}</h1>
                    {event.shortdescription && <p className="mt-4 text-lg leading-relaxed text-zinc-600">{event.shortdescription}</p>}
                    <dl className="my-6 grid gap-5 rounded-xl border border-zinc-200 p-5 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Beginn</dt>
                            <dd className="mt-1">{date.format(event.beginsAt)} Uhr</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ende</dt>
                            <dd className="mt-1">{date.format(event.endsAt)} Uhr</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Veranstaltungsort</dt>
                            <dd className="mt-1">{event.venue ? <>{event.venue.name}<p className="mt-1 text-sm text-zinc-500">{[event.venue.addressLine1, event.venue.addressLine2, [event.venue.postalCode, event.venue.city].filter(Boolean).join(" "), event.venue.countryCode].filter(Boolean).join(", ")}</p></> : "Wird noch bekanntgegeben"}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Preis pro Platz</dt>
                            <dd className="mt-1">{Number(event.ticketPrice).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {event.currency}</dd>
                        </div>
                        {event.trainerName &&
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">Trainer</dt>
                                <dd className="mt-1">{event.trainerName}</dd>
                            </div>
                        }
                    </dl>
                    <p className="mb-6 text-xs text-zinc-400">Alle Eventzeiten in Europe/Berlin.</p>
                    {event.description && <section><h2 className="text-xl font-semibold">Über das Event</h2><p className="mt-4 whitespace-pre-wrap leading-relaxed text-zinc-600">{event.description}</p></section>}
                </article>
                <aside className="lg:sticky lg:top-6"><PublicBookingForm initialName={signedIn ? session?.user?.name ?? "" : ""} initialEmail={signedIn ? session?.user?.email ?? "" : ""} slug={companySlug} eventId={event.id} token={token} price={event.ticketPrice} currency={event.currency} available={event.available} started={event.beginsAt <= new Date()} /></aside>
            </div>
        </main>
    </div>;
}
