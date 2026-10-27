import { redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getMyBookings } from "@/lib/cancellations/data";
import { cancellationPolicy, cancellationPolicyText, requestLabels, refundLabels } from "@/lib/cancellations/policy";
import { CancellationActionForm } from "@/components/cancellation-action-form";
import { RefreshStatusButton } from "@/components/refresh-status-button";

export default async function MyBookingsPage() {
  let bookings;
  try { bookings = await getMyBookings(); }
  catch (error) { if (error instanceof MemberAccessError && error.reason === "UNAUTHENTICATED") redirect("/login"); throw error; }
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const statuses = { CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" };
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <h1 className="text-2xl font-semibold">Meine Buchungen</h1>
    <RefreshStatusButton />
    <p className="text-sm text-zinc-500">Stornierungen gelten für die gesamte Buchung. Alle Zeitangaben in Europe/Berlin.</p>
    {!bookings.length && <p>Noch keine Buchungen mit deinem Konto verknüpft.</p>}
    {bookings.map((booking) => {
      const policy = cancellationPolicy(booking.event.beginsAt, booking.event.freeCancellationUntilMinutesBeforeStart);
      const active = booking.cancellationRequests.some((r) => r.status === "PENDING" || r.status === "APPROVED");
      const eligible = booking.status === "CONFIRMED" && (!booking.payment || booking.payment.status === "PAID") && !policy.started && !active;
      return <section key={booking.id} className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold">{booking.event.name} · Buchung #{booking.number}</h2>
        <p className="text-sm">{booking.event.company.name} · {booking.quantity} Platz/Plätze · {statuses[booking.status]}</p>
        <p className="mt-2 text-sm">Beginn: {booking.event.beginsAt ? date.format(booking.event.beginsAt) : "Noch offen"}</p>
        <p className="mt-2 text-sm">{cancellationPolicyText(booking.event.freeCancellationUntilMinutesBeforeStart)}</p>
        {policy.deadline && <p className="text-sm">Kostenfreie Frist bis einschließlich {date.format(policy.deadline)}.</p>}
        {!booking.event.beginsAt && <p className="text-sm">Ohne Starttermin ist nur eine manuelle Anfrage möglich.</p>}
        {policy.started && <p className="text-sm">Das Event hat begonnen; eine Stornierung ist nicht mehr möglich.</p>}
        {booking.payment && <p className="text-sm">Zahlung: {({ PAID: "Bezahlt", PENDING: "Ausstehend", EXPIRED: "Abgelaufen", REFUNDED: "Vollständig erstattet", PARTIALLY_REFUNDED: "Teilweise erstattet – bitte Veranstalter kontaktieren" })[booking.payment.status]}</p>}
        {booking.cancellationRequests.map((request) => <div key={request.id} className="mt-4 rounded-lg bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
          <p className="font-medium">{requestLabels[request.status]}</p>
          <p>Angefragt: {date.format(request.requestedAt)}{request.decidedAt ? ` · Bearbeitet: ${date.format(request.decidedAt)}` : ""}</p>
          {request.customerReason && <p className="whitespace-pre-wrap">Dein Hinweis: {request.customerReason}</p>}
          {request.status === "APPROVED" && <p>{refundLabels[request.refundStatus]}</p>}
          {request.status === "PENDING" && <CancellationActionForm id={request.id} intent="withdraw" label="Anfrage zurückziehen" />}
        </div>)}
        {eligible && <CancellationActionForm id={booking.id} intent={policy.free ? "free" : "request"} label={policy.free ? "Kostenfrei stornieren" : "Stornierung anfragen"} noteLabel="Hinweis / Grund (optional)" />}
      </section>;
    })}
  </main>;
}
