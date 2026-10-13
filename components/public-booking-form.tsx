"use client";
import { useActionState, useState } from "react";
import { bookPublicEvent, type PublicBookingState } from "@/app/(public)/events/[companySlug]/[eventId]/actions";
export function PublicBookingForm({ slug, eventId, token, price, currency, available, started, initialName = "", initialEmail = "" }: { slug: string; eventId: string; token: string; price: string; currency: string; available: number; started: boolean; initialName?: string; initialEmail?: string }) {
    const [quantity, setQuantity] = useState("1");
    const [state, action, pending] = useActionState<PublicBookingState, FormData>(bookPublicEvent.bind(null, slug, eventId), {});
    const total = (Number(price) * (Number(quantity) || 0)).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (state.success) return <section aria-live="polite" className="rounded-xl border border-teal-200 bg-teal-50 p-6"><h2 className="text-xl font-semibold text-teal-900">Vielen Dank für deine Buchung!</h2><p className="mt-3">Deine Buchungsnummer: <strong>#{state.number}</strong></p><p className="mt-2 text-sm text-zinc-600">{state.message} Bitte notiere dir diese Nummer. Es wurde keine Online-Zahlung durchgeführt.</p></section>;
    if (started || available === 0) return <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-6"><h2 className="text-xl font-semibold">{started ? "Buchung geschlossen" : "Ausgebucht"}</h2><p className="mt-2 text-sm text-zinc-600">{started ? "Dieses Event hat bereits begonnen." : "Für dieses Event sind aktuell keine Plätze mehr frei."}</p></section>;
    const input = "mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-teal-600";
    return <form action={action} className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Plätze buchen</h2>
        <p className="text-sm text-zinc-500">Noch {available} {available === 1 ? "Platz verfügbar" : "Plätze verfügbar"}<br />Kein Account erforderlich</p>
        <input type="hidden" name="token" value={token} />
        <div hidden aria-hidden="true"><label htmlFor="booking-website">Website</label><input id="booking-website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <fieldset disabled={pending} className="space-y-4">
            <div><label htmlFor="guest-name" className="text-sm font-medium">Dein Name</label><input id="guest-name" name="name" defaultValue={initialName} required maxLength={160} autoComplete="name" className={input} /></div>
            <div><label htmlFor="guest-email" className="text-sm font-medium">E-Mail-Adresse</label><input id="guest-email" name="email" defaultValue={initialEmail} type="email" required maxLength={254} autoComplete="email" className={input} /></div>
            <div><label htmlFor="guest-quantity" className="text-sm font-medium">Anzahl Plätze</label><input id="guest-quantity" name="quantity" type="number" min={1} max={available} step={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} /></div>
        </fieldset>
        <div className="flex justify-between border-t border-zinc-100 pt-4 font-semibold"><span>Gesamtpreis</span><span>{total} {currency}</span></div>
        <p className="text-xs leading-relaxed text-zinc-500">Hier buchst du deine Plätze direkt beim Veranstalter. Du erhältst eine Buchungsbestätigung per E-Mail. Eine Online-Zahlung ist derzeit nicht eingerichtet.</p>
        {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
        <button disabled={pending} className="w-full rounded-md bg-teal-600 px-5 py-3 font-semibold text-white hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50">{pending ? "Wird gebucht …" : "Jetzt buchen"}</button>
    </form >;
}
