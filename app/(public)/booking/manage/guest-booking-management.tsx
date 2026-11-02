"use client";

import { useActionState, useEffect, useState } from "react";
import type { GuestBooking } from "@/lib/bookings/guest-management";
import { cancelGuestBooking, loadGuestBooking, type GuestBookingState } from "./actions";

const date = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(value));

function BookingDetails({ token, initial }: { token: string; initial: GuestBooking }) {
  const [state, action, pending] = useActionState<GuestBookingState, FormData>(cancelGuestBooking.bind(null, token), { booking: initial });
  const booking = state.booking ?? initial;
  return <section className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
    <header><h1 className="text-2xl font-semibold">Buchung #{booking.number} verwalten</h1><p className="mt-2 text-lg">{booking.eventName}</p><p className="text-sm text-zinc-500">{booking.companyName}</p></header>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <dt>Beginn (Europe/Berlin)</dt><dd>{booking.beginsAt ? date(booking.beginsAt) : "Termin noch offen"}</dd>
      <dt>Anzahl Tickets</dt><dd>{booking.quantity}</dd>
      <dt>Buchungsstatus</dt><dd>{({ CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" })[booking.status] ?? booking.status}</dd>
      {booking.deadline && <><dt>Kostenfreie Stornierung bis</dt><dd>{date(booking.deadline)} Uhr (Europe/Berlin)</dd></>}
    </dl>
    {booking.cancellation && <div className="rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-900"><p>{booking.cancellation.status}</p><p className="mt-1">{booking.cancellation.refund}</p></div>}
    {state.message && <p role="status" className={state.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>{state.message}</p>}
    {booking.unavailableReason && <p>{booking.unavailableReason}</p>}
    {booking.canCancel && !state.success && <form action={action} className="space-y-4">
      <h2 className="text-lg font-semibold">Gesamte Buchung stornieren</h2>
      <p className="font-medium">Diese Stornierung betrifft alle {booking.quantity} Tickets dieser Buchung. Einzelne Tickets können hier nicht storniert werden.</p>
      <p className="text-sm">{booking.free
        ? "Du kannst die gesamte Buchung jetzt kostenfrei stornieren. Eine vorhandene Onlinezahlung wird vollständig erstattet; die Erstattung kann noch ausstehen."
        : "Eine direkte kostenfreie Stornierung ist derzeit nicht möglich. Du kannst eine Stornierungsanfrage an den Veranstalter senden. Bis zur Genehmigung bleiben deine Tickets gültig."}</p>
      <input type="hidden" name="intent" value={booking.free ? "free" : "request"} />
      <fieldset disabled={pending} className="space-y-4">
        <label className="block text-sm">Hinweis / Grund (optional)<textarea name="note" maxLength={2000} rows={3} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" required className="mt-1" />Ich bestätige, dass {booking.free ? "die Stornierung" : "die Stornierungsanfrage"} die gesamte Buchung mit allen {booking.quantity} Tickets betrifft.</label>
        <button disabled={pending} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{pending ? "Wird verarbeitet …" : booking.free ? "Alle Tickets kostenfrei stornieren" : "Stornierung für alle Tickets anfragen"}</button>
      </fieldset>
    </form>}
    <p className="text-xs text-zinc-500">Dieser Verwaltungslink ist für die buchende Person bestimmt. Gib zum Weiterleiten einzelner Tickets nur den jeweiligen Ticketlink weiter.</p>
  </section>;
}

export function GuestBookingManagement() {
  const [loaded, setLoaded] = useState<{ token: string; state: GuestBookingState } | null>(null);
  useEffect(() => {
    let active = true;
    const token = window.location.hash.slice(1);
    async function load() {
      try {
        const state = await loadGuestBooking(token);
        if (active) setLoaded({ token, state });
      } catch { if (active) setLoaded({ token, state: { message: "Die Buchung kann gerade nicht geladen werden. Bitte lade die Seite erneut." } }); }
    }
    void load();
    return () => { active = false; };
  }, []);
  return <main className="mx-auto w-full max-w-2xl px-5 py-10">
    {loaded?.state.booking ? <BookingDetails token={loaded.token} initial={loaded.state.booking} /> : <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800"><h1 className="text-2xl font-semibold">Buchung verwalten</h1><p role="status" className="mt-4">{loaded?.state.message ?? "Buchung wird geladen …"}</p></section>}
  </main>;
}
