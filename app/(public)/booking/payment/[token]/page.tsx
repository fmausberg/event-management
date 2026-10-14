import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "@/lib/db/prisma";
import { updateCheckout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deine Ticketzahlung", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function PaymentPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9-]{36}$/.test(token)) notFound();
  const payment = await getPrisma().payment.findUnique({ where: { publicToken: token }, include: { booking: { select: { number: true, event: { select: { id: true, company: { select: { slug: true } } } } } }, mail: { select: { sentAt: true } } } });
  if (!payment) notFound();
  const pending = payment.status === "PENDING";
  const paid = payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED";
  return <main className="mx-auto max-w-xl space-y-5 p-8">
    <h1 className="text-2xl font-semibold">{paid ? "Deine Buchung ist bestätigt" : payment.status === "REFUNDED" ? "Deine Zahlung wurde erstattet" : pending ? "Deine Ticketzahlung" : "Deine Reservierung ist abgelaufen"}</h1>
    <p>Buchungsnummer: <strong>#{payment.booking.number}</strong></p>
    <p>{paid ? payment.mail?.sentAt ? "Deine Tickets wurden per E-Mail versendet." : "Deine Zahlung ist bestätigt. Die E-Mail mit deinen Tickets wird versendet." : pending ? "Falls du bereits bezahlt hast, wird deine Zahlung noch bestätigt. Bitte buche nicht erneut. Du kannst den Status prüfen oder eine offene Zahlung fortsetzen." : payment.status === "REFUNDED" ? "Die Tickets dieser Buchung sind nicht mehr gültig." : "Für diese Reservierung wurde keine Zahlung abgeschlossen. Du kannst erneut buchen."}</p>
    {payment.status === "PARTIALLY_REFUNDED" && <p>Ein Teilbetrag wurde erstattet. Deine Tickets bleiben gültig.</p>}
    {(await searchParams).error && <p role="alert">Der Status konnte gerade nicht aktualisiert werden. Bitte versuche es erneut.</p>}
    {pending && <div className="flex flex-wrap gap-4">
      <form action={updateCheckout.bind(null, token, false)}><button className="rounded bg-primary-700 px-4 py-2 text-white">Zahlung prüfen / fortsetzen</button></form>
      <form action={updateCheckout.bind(null, token, true)}><button className="px-4 py-2 underline">Offene Reservierung abbrechen</button></form>
    </div>}
    <Link className="block underline" href={`/events/${encodeURIComponent(payment.booking.event.company.slug)}/${payment.booking.event.id}`}>Zum Event</Link>
  </main>;
}
