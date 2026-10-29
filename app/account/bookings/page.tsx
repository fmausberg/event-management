import { VoucherCancellationStatus } from "@/components/voucher-cancellation-status";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getMyBookings } from "@/lib/cancellations/data";
import { cancellationPolicy, requestLabels, refundLabels } from "@/lib/cancellations/policy";
import { eventDuration, groupBookings, shortCancellationPolicy } from "@/lib/bookings/presentation";
import { BookingCancellation } from "@/components/booking-cancellation";
import { CancellationActionForm } from "@/components/cancellation-action-form";
import { RefreshStatusButton } from "@/components/refresh-status-button";

export default async function MyBookingsPage() {
  let bookings;
  try { bookings = await getMyBookings(); }
  catch (error) { if (error instanceof MemberAccessError && error.reason === "UNAUTHENTICATED") redirect("/login"); throw error; }
  const now = new Date();
  const groups = groupBookings(bookings, now);
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const statuses = { CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" };
  return <main className="min-w-0 flex-1 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Meine Buchungen</h1><p className="mt-2 text-sm text-zinc-500">Deine Events und Tickets im Überblick. Alle Uhrzeiten in Europe/Berlin.</p></div>
        <RefreshStatusButton />
      </header>
      {!bookings.length ? <p className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">Noch keine Buchungen mit deinem Konto verknüpft.</p> : ([
        { title: "Kommende Events", items: groups.upcoming, empty: "Keine kommenden Events gebucht." },
        { title: "Vergangene Events", items: groups.past, empty: "Noch keine vergangenen Events." },
      ]).map((group) => <section key={group.title} className="space-y-4" aria-label={group.title}>
        <h2 className="flex items-center gap-3 text-lg font-semibold">{group.title}<span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs dark:bg-zinc-800">{group.items.length}</span></h2>
        {!group.items.length && <p className="text-sm text-zinc-500">{group.empty}</p>}
        {group.items.map((booking) => {
          const event = booking.event;
          const policy = cancellationPolicy(event.beginsAt, event.freeCancellationUntilMinutesBeforeStart, now);
          const active = booking.cancellationRequests.some((r) => r.status === "PENDING" || r.status === "APPROVED");
          const eligible = booking.status === "CONFIRMED" && (!booking.payment || booking.payment.status === "PAID") && !policy.started && !active && event.status !== "CANCELLED" && event.status !== "COMPLETED";
          const venue = event.venue;
          const address = venue ? [venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" "), venue.countryCode].filter(Boolean).join(", ") : null;
          return <article key={booking.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-medium text-zinc-500">{event.company.name} · Buchung #{booking.number}</p><h3 className="mt-1 break-words text-xl font-semibold">{event.name}</h3></div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${booking.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{statuses[booking.status]}</span>
              </div>
              {event.status === "CANCELLED" && <p className="text-sm text-red-700 dark:text-red-300">Das Event wurde abgesagt.</p>}
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-zinc-500">Eventbeginn</dt><dd className="mt-1 font-medium">{event.beginsAt ? date.format(event.beginsAt) : "Termin noch offen"}</dd></div>
                <div><dt className="text-zinc-500">Dauer</dt><dd className="mt-1 font-medium">{eventDuration(event.beginsAt, event.endsAt)}</dd></div>
                <div><dt className="text-zinc-500">Location / Adresse</dt><dd className="mt-1 font-medium">{venue?.name ?? "Noch offen"}{address && <span className="mt-1 block font-normal text-zinc-500">{address}</span>}</dd></div>
              </dl>
              <Link href={`/events/${event.company.slug}/${event.id}`} className="inline-flex text-sm font-medium underline underline-offset-4">Event ansehen <span aria-hidden="true" className="ml-1">↗</span></Link>
              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <h4 className="text-sm font-medium">Tickets <span className="font-normal text-zinc-500">· {booking.quantity} {booking.quantity === 1 ? "Platz" : "Plätze"}</span></h4>
                <div className="mt-2 flex flex-wrap gap-2">{booking.tickets.map((ticket) => <Link key={ticket.id} href={`/account/tickets/${ticket.id}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Ticket #{ticket.number}{ticket.status === "CANCELLED" ? " · Storniert" : ""}</Link>)}</div>
                {!booking.tickets.length && <p className="mt-2 text-sm text-zinc-500">{booking.status === "PENDING_PAYMENT" ? "Tickets werden nach erfolgreicher Zahlung bereitgestellt." : "Keine Tickets vorhanden."}</p>}
              </div>
              <VoucherCancellationStatus booking={booking} />
              {booking.payment && <p className="text-xs text-zinc-500">Zahlung: {({ PAID: "Bezahlt", PENDING: "Ausstehend", EXPIRED: "Abgelaufen", REFUNDED: "Vollständig erstattet", PARTIALLY_REFUNDED: "Teilweise erstattet – bitte Veranstalter kontaktieren" })[booking.payment.status]}</p>}
            </div>
            <div className="space-y-4 border-t border-zinc-200 p-5 sm:p-6 dark:border-zinc-800">
              <div className="space-y-1 text-xs text-zinc-500"><p className="font-medium text-zinc-700 dark:text-zinc-300">{shortCancellationPolicy(event.freeCancellationUntilMinutesBeforeStart)}</p>
                {eligible && policy.free && <p>Kostenfrei stornierbar bis einschließlich {date.format(policy.deadline!)}.</p>}
                {eligible && !policy.free && <p>{event.beginsAt ? "Eine Stornierung muss vom Veranstalter genehmigt werden." : "Ohne Starttermin ist nur eine Anfrage möglich."}</p>}
                {policy.started && <p>Event bereits begonnen · keine Stornierung mehr möglich.</p>}
              </div>
              {eligible && <BookingCancellation id={booking.id} free={policy.free} />}
              {booking.cancellationRequests.map((request) => <div key={request.id} className="rounded-lg bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
                <p className="font-medium">{requestLabels[request.status]}</p>
                <p className="mt-1 text-xs text-zinc-500">Angefragt: {date.format(request.requestedAt)}{request.decidedAt ? ` · Bearbeitet: ${date.format(request.decidedAt)}` : ""}</p>
                {request.customerReason && <p className="mt-2 whitespace-pre-wrap break-words">Dein Hinweis: {request.customerReason}</p>}
                {request.status === "APPROVED" && <p className="mt-2">{refundLabels[request.refundStatus]}</p>}
                {request.status === "PENDING" && <CancellationActionForm id={request.id} intent="withdraw" label="Anfrage zurückziehen" />}
              </div>)}
            </div>
          </article>;
        })}
      </section>)}
    </div>
  </main>;
}
