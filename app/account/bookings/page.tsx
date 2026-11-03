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
  const statusColors = {
    CONFIRMED: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    CANCELLED: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
    PENDING_PAYMENT: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    EXPIRED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return <main className="min-w-0 flex-1 bg-zinc-50 p-4 sm:p-6 dark:bg-black">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Meine Buchungen</h1><p className="mt-1 text-xs text-zinc-500">Deine Veranstaltungen und Tickets im Überblick. Alle Uhrzeiten in Europe/Berlin.</p></div>
        <RefreshStatusButton />
      </header>
      {!bookings.length ? <p className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">Noch keine Buchungen mit deinem Konto verknüpft.</p> : ([
        { title: "Kommende Veranstaltungen", items: groups.upcoming, empty: "Keine kommenden Veranstaltungen gebucht.", open: true },
        { title: "Vergangene Veranstaltungen", items: groups.past, empty: "Noch keine vergangenen Veranstaltungen.", open: false },
      ]).map((group) => <details key={group.title} open={group.open} className="space-y-4" aria-label={group.title}>
        <summary className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"><h2 className="inline-flex items-center gap-3 text-lg font-semibold">{group.title}<span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs dark:bg-zinc-800">{group.items.length}</span></h2></summary>
        {!group.items.length && <p className="text-sm text-zinc-500">{group.empty}</p>}
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{group.items.map((booking) => {
          const event = booking.event;
          const policy = cancellationPolicy(event.beginsAt, event.freeCancellationUntilMinutesBeforeStart, now);
          const active = booking.cancellationRequests.some((r) => r.status === "PENDING" || r.status === "APPROVED");
          const eligible = booking.status === "CONFIRMED" && (!booking.payment || booking.payment.status === "PAID") && !policy.started && !active && event.status !== "CANCELLED" && event.status !== "COMPLETED";
          const venue = event.venue;
          const address = venue ? [venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" "), venue.countryCode].filter(Boolean).join(", ") : null;
          return <article key={booking.id} className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-500">Buchung #{booking.number}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[booking.status]}`}>{statuses[booking.status]}</span>
              </div>
              <div><h3 className="break-words text-base font-semibold leading-snug">{event.name}</h3><p className="mt-1 break-words text-xs text-zinc-500">{event.company.name}</p></div>
              {event.status === "CANCELLED" && <p className="text-xs text-red-700 dark:text-red-300">Die Veranstaltung wurde abgesagt.</p>}
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs">
                <div><dt className="sr-only">Veranstaltungsbeginn</dt><dd className="font-medium">{event.beginsAt ? date.format(event.beginsAt) : "Termin noch offen"}</dd></div>
                <div><dt className="sr-only">Dauer</dt><dd className="font-medium">{eventDuration(event.beginsAt, event.endsAt)}</dd></div>
                <div className="col-span-2 min-w-0"><dt className="sr-only">Location / Adresse</dt><dd className="break-words font-medium">{venue?.name ?? "Noch offen"}{address && <span className="mt-0.5 block font-normal text-zinc-500">{address}</span>}</dd></div>
              </dl>
              <details className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <summary className="cursor-pointer text-xs font-medium">Tickets <span className="font-normal text-zinc-500">· {booking.quantity} {booking.quantity === 1 ? "Platz" : "Plätze"}</span></summary>
                <div className="mt-2 flex flex-wrap gap-2">{booking.tickets.map((ticket) => <Link key={ticket.id} href={`/account/tickets/${ticket.id}`} className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Ticket #{ticket.number}{ticket.status === "CANCELLED" ? " · Storniert" : ""}</Link>)}</div>
                {!booking.tickets.length && <p className="mt-2 text-sm text-zinc-500">{booking.status === "PENDING_PAYMENT" ? "Tickets werden nach erfolgreicher Zahlung bereitgestellt." : "Keine Tickets vorhanden."}</p>}
              </details>
              <VoucherCancellationStatus booking={booking} />
              {booking.payment && <p className="text-xs text-zinc-500">Zahlung: {({ PAID: "Bezahlt", PENDING: "Ausstehend", EXPIRED: "Abgelaufen", REFUNDED: "Vollständig erstattet", PARTIALLY_REFUNDED: "Teilweise erstattet – bitte Veranstalter kontaktieren" })[booking.payment.status]}</p>}
            </div>
            <div className="space-y-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={`/events/${event.company.slug}/${event.id}`} className="py-2 text-xs font-medium underline underline-offset-4">Veranstaltung ansehen <span aria-hidden="true">↗</span></Link>
                {eligible && <BookingCancellation id={booking.id} free={policy.free} />}
              </div>
              <details className="text-xs text-zinc-500"><summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">{shortCancellationPolicy(event.freeCancellationUntilMinutesBeforeStart)}</summary><div className="mt-2 space-y-1">
                {eligible && policy.free && <p>Kostenfrei stornierbar bis einschließlich {date.format(policy.deadline!)}.</p>}
                {eligible && !policy.free && <p>{event.beginsAt ? "Eine Stornierung muss vom Veranstalter genehmigt werden." : "Ohne Starttermin ist nur eine Anfrage möglich."}</p>}
                {policy.started && <p>Veranstaltung bereits begonnen · keine Stornierung mehr möglich.</p>}
              </div></details>
              {booking.cancellationRequests.map((request) => <details key={request.id} className="rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                <summary className="cursor-pointer font-medium">{requestLabels[request.status]}{request.status === "APPROVED" && <span className="mt-1 block font-normal">{refundLabels[request.refundStatus]}</span>}</summary>
                <p className="mt-1 text-xs text-zinc-500">Angefragt: {date.format(request.requestedAt)}{request.decidedAt ? ` · Bearbeitet: ${date.format(request.decidedAt)}` : ""}</p>
                {request.customerReason && <p className="mt-2 whitespace-pre-wrap break-words">Dein Hinweis: {request.customerReason}</p>}
                {request.status === "PENDING" && <CancellationActionForm id={request.id} intent="withdraw" label="Anfrage zurückziehen" />}
              </details>)}
            </div>
          </article>;
        })}</div>
      </details>)}
    </div>
  </main>;
}
