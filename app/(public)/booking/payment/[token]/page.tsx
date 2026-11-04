import { refundLabels } from "@/lib/cancellations/policy";
import { auth } from "@/auth";
import { readBookingConfirmationToken } from "@/lib/bookings/public-token";
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
  const bookingId = readBookingConfirmationToken(token);
  if (!bookingId && !/^[a-f0-9-]{36}$/.test(token)) notFound();
  const freeBooking = bookingId ? await getPrisma().booking.findUnique({ where: { id: bookingId }, select: {
    status: true, number: true, payment: { select: { id: true } },
    cancellationRequests: { where: { status: "APPROVED" }, select: { refundStatus: true }, take: 1 },
    event: { select: { id: true, company: { select: { slug: true } } } },
    ticketMails: { where: { requestKey: `initial:${bookingId}` }, select: { sentAt: true }, take: 1 },
  } }) : null;
  if (bookingId && (!freeBooking || freeBooking.payment)) notFound();
  const payment = freeBooking ? {
    booking: freeBooking, status: freeBooking.status === "CONFIRMED" || freeBooking.status === "CANCELLED" ? "PAID" : "EXPIRED",
    mail: freeBooking.ticketMails[0],
  } : await getPrisma().payment.findUnique({ where: { publicToken: token }, include: { booking: { select: { status: true, cancellationRequests: { where: { status: "APPROVED" }, select: { refundStatus: true }, take: 1 }, number: true, event: { select: { id: true, company: { select: { slug: true } } } } } }, mail: { select: { sentAt: true } } } });
  if (!payment) notFound();
  const signedIn = !!(await auth())?.user?.id;
  const buttonClassName = "inline-flex items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700";
  const pending = payment.status === "PENDING";
  const cancelled = payment.booking.status === "CANCELLED";
  const cancellation = payment.booking.cancellationRequests?.[0];
  const paid = !cancelled && (payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED");
  return <main className="mx-auto max-w-xl space-y-5 p-8">
    <h1 className="text-2xl font-semibold">{cancelled ? "Deine Buchung ist storniert" : paid ? "Deine Buchung ist bestätigt" : payment.status === "REFUNDED" ? "Deine Zahlung wurde erstattet" : pending ? "Deine Ticketzahlung" : "Deine Reservierung ist abgelaufen"}</h1>
    <p>Buchungsnummer: <strong>#{payment.booking.number}</strong></p>
    <p>{cancelled ? "Die Tickets dieser Buchung sind nicht mehr gültig." : paid ? freeBooking ? payment.mail?.sentAt ? "Deine Tickets wurden per E-Mail versendet." : "Deine Buchung ist bestätigt. Die E-Mail mit deinen Tickets wird versendet." : payment.mail?.sentAt ? "Deine Tickets wurden per E-Mail versendet." : "Deine Zahlung ist bestätigt. Die E-Mail mit deinen Tickets wird versendet." : pending ? "Falls du bereits bezahlt hast, wird deine Zahlung noch bestätigt. Bitte buche nicht erneut. Du kannst den Status prüfen oder eine offene Zahlung fortsetzen." : payment.status === "REFUNDED" ? "Die Tickets dieser Buchung sind nicht mehr gültig." : "Für diese Reservierung wurde keine Zahlung abgeschlossen. Du kannst erneut buchen."}</p>
    {cancellation && <p>{refundLabels[cancellation.refundStatus]}</p>}
    {!cancelled && payment.status === "PARTIALLY_REFUNDED" && <p>Ein Teilbetrag wurde erstattet. Deine Tickets bleiben gültig.</p>}
    {(await searchParams).error && <p role="alert">Der Status konnte gerade nicht aktualisiert werden. Bitte versuche es erneut.</p>}
    {pending && <div className="flex flex-wrap gap-4">
      <form action={updateCheckout.bind(null, token, false)}><button className="rounded bg-primary-700 px-4 py-2 text-white">Zahlung prüfen / fortsetzen</button></form>
      <form action={updateCheckout.bind(null, token, true)}><button className="px-4 py-2 underline">Offene Reservierung abbrechen</button></form>
    </div>}
    <div className="flex flex-wrap gap-3">
      <Link className={buttonClassName} href={`/events/${encodeURIComponent(payment.booking.event.company.slug)}/${payment.booking.event.id}`}>Zur Veranstaltung</Link>
      <Link className={buttonClassName} href="/events">Zur Veranstaltungsübersicht</Link>
      {signedIn && <Link className={buttonClassName} href="/account/bookings">Meine Buchungen</Link>}
    </div>
  </main>;
}
