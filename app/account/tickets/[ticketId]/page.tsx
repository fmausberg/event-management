import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { MemberAccessError } from "@/lib/companies/members";
import { getMyTicket } from "@/lib/tickets/account";
import { createAccountTicketToken } from "@/lib/tickets/account-token";
import { RefreshStatusButton } from "@/components/refresh-status-button";

export const metadata = { title: "Mein Ticket", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function MyTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  let ticket;
  try { ticket = await getMyTicket(ticketId); }
  catch (error) { if (error instanceof MemberAccessError && error.reason === "UNAUTHENTICATED") redirect("/login"); throw error; }
  if (!ticket) notFound();
  const { event } = ticket.booking;
  const cancelled = ticket.status === "CANCELLED" || ticket.booking.status === "CANCELLED" || event.status === "CANCELLED";
  const valid = !cancelled && ticket.booking.status === "CONFIRMED" && !ticket.checkedInAt;
  const credential = valid ? createAccountTicketToken(ticket.id) : null;
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const venue = event.venue;
  return <main className="mx-auto w-full max-w-xl px-5 py-10">
    <Link href="/account/bookings" className="text-sm underline underline-offset-4">← Meine Buchungen</Link>
    <section className="mt-6 space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">Ticket #{ticket.number} · Buchung #{ticket.booking.number}</p>
      <h1 className="text-2xl font-semibold">{event.name}</h1>
      <p>{event.beginsAt ? `${date.format(event.beginsAt)} Uhr (Berlin)` : "Termin noch offen"}</p>
      {venue && <p>{[venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>}
      <p className="font-medium">{cancelled ? "Storniert" : ticket.checkedInAt ? `Bereits eingelöst am ${date.format(ticket.checkedInAt)}` : valid ? "Gültig" : "Nicht gültig"}</p>
      {credential && <figure className="flex flex-col items-center gap-4 rounded-lg bg-white p-4 text-zinc-900">
        <QRCodeSVG value={credential.token} size={260} level="M" marginSize={4} title={`QR-Code für Ticket #${ticket.number}`} className="h-auto max-w-full" />
        <figcaption className="text-center text-sm">Zeige diesen QR-Code beim Einlass vor.<br /><span className="text-xs text-zinc-500">QR-Code gültig bis {date.format(new Date(credential.expires))} Uhr (Berlin). Danach diese Seite erneut laden.</span></figcaption>
      </figure>}
      <RefreshStatusButton />
    </section>
  </main>;
}
