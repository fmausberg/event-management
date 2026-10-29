"use client";
import { useActionState, useState, useTransition } from "react";
import { bookPublicEvent, previewPublicVoucher, type PublicBookingState, type PublicVoucherState } from "@/app/(public)/events/[companySlug]/[eventId]/actions";
export function PublicBookingForm({ slug, eventId, token, price, currency, available, started, initialName = "", initialEmail = "" }: { slug: string; eventId: string; token: string; price: string; currency: string; available: number; started: boolean; initialName?: string; initialEmail?: string }) {
    const [quantity, setQuantity] = useState("1");
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState("");
    const [checking, startChecking] = useTransition();
    const [preview, setPreview] = useState<{ key: string; result: PublicVoucherState } | null>(null);
    const previewKey = JSON.stringify([quantity, email, code]);
    const currentPreview = preview?.key === previewKey ? preview.result : null;
    const quoted = code.trim() ? currentPreview?.price : undefined;
    const money = (cents: number) => (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [state, action, pending] = useActionState<PublicBookingState, FormData>(bookPublicEvent.bind(null, slug, eventId), {});
    const total = (Number(price) * (Number(quantity) || 0)).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (state.success) return <section aria-live="polite" className="rounded-xl border border-primary-200 bg-primary-50 p-6"><h2 className="text-xl font-semibold text-primary-900">Vielen Dank für deine Buchung!</h2><p className="mt-3">Deine Buchungsnummer: <strong>#{state.number}</strong></p><p className="mt-2 text-sm text-zinc-600">{state.message} Bitte notiere dir diese Nummer.</p></section>;
    if (started || available === 0) return <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-6"><h2 className="text-xl font-semibold">{started ? "Buchung geschlossen" : "Ausgebucht"}</h2><p className="mt-2 text-sm text-zinc-600">{started ? "Dieses Event hat bereits begonnen." : "Für dieses Event sind aktuell keine Plätze mehr frei."}</p></section>;
    const input = "mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-primary-600";
    return <form action={action} className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Plätze buchen</h2>
        <p className="text-sm text-zinc-500">Noch {available} {available === 1 ? "Platz verfügbar" : "Plätze verfügbar"}<br />Kein Account erforderlich</p>
        <input type="hidden" name="token" value={token} />
        <div hidden aria-hidden="true"><label htmlFor="booking-website">Website</label><input id="booking-website" name="website" tabIndex={-1} autoComplete="off" /></div>
        <fieldset disabled={pending || checking} className="space-y-4">
            <div><label htmlFor="guest-name" className="text-sm font-medium">Dein Name</label><input id="guest-name" name="name" defaultValue={initialName} required maxLength={160} autoComplete="name" className={input} /></div>
            <div><label htmlFor="guest-email" className="text-sm font-medium">E-Mail-Adresse</label><input id="guest-email" name="email" value={email} onChange={e => setEmail(e.target.value)} type="email" required maxLength={254} autoComplete="email" className={input} /></div>
            <div><label htmlFor="guest-quantity" className="text-sm font-medium">Anzahl Plätze</label><input id="guest-quantity" name="quantity" type="number" min={1} max={Math.min(available, 100)} step={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} /></div>
            <div><label htmlFor="voucher-code" className="text-sm font-medium">Gutscheincode (optional)</label><input id="voucher-code" name="code" value={code} onChange={e => setCode(e.target.value)} maxLength={128} autoComplete="off" spellCheck={false} className={input} />
                <button type="button" disabled={!code.trim()} className="mt-2 text-sm font-medium text-primary-700 disabled:opacity-50" onClick={e => {
                    const data = new FormData(e.currentTarget.form!);
                    const key = previewKey;
                    startChecking(async () => {
                        try { setPreview({ key, result: await previewPublicVoucher(slug, eventId, data) }); }
                        catch { setPreview({ key, result: { message: "Die Gutscheinprüfung ist derzeit nicht verfügbar." } }); }
                    });
                }}>{checking ? "Preis wird geprüft …" : "Preis mit Gutschein prüfen"}</button>
            </div>
        </fieldset>
        <div aria-live="polite" className="space-y-2 border-t border-zinc-100 pt-4">
            <div className="flex justify-between"><span>Originalpreis</span><span>{quoted ? money(quoted.originalAmountMinor) : total} {currency}</span></div>
            {quoted && <>
                <div className="flex justify-between"><span>Rabatt</span><span>−{money(quoted.discountAmountMinor)} {currency}</span></div>
                <div className="flex justify-between"><span>Wertgutscheineinsatz</span><span>−{money(quoted.voucherAmountMinor)} {currency}</span></div>
            </>}
            <div className="flex justify-between font-semibold"><span>Zu zahlen</span><span>{quoted ? money(quoted.payableAmountMinor) : total} {currency}</span></div>
            {code.trim() && !quoted && <p className="text-xs text-zinc-600">Bitte prüfe den Gutschein für die aktuelle Anzahl und E-Mail-Adresse.</p>}
            {quoted && <p className="text-xs text-zinc-600">Der Gutschein wird beim Buchen erneut geprüft. {quoted.requiresCheckout ? "Den Restbetrag bezahlst du über Stripe." : "Es ist keine Online-Zahlung nötig."}</p>}
            {currentPreview?.message && <p role="alert" className="text-sm text-red-700">{currentPreview.message}</p>}
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">Hier buchst du deine Plätze direkt beim Veranstalter. Kostenpflichtige Tickets bezahlst du im nächsten Schritt sicher über Stripe. Deine Tickets erhältst du nach bestätigter Zahlung per E-Mail.</p>
        {state.message && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
        <button disabled={pending || checking || !!code.trim() && !quoted} className="w-full rounded-md bg-accent-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50">{pending ? "Wird gebucht …" : (quoted ? quoted.requiresCheckout : Number(price) > 0) ? "Zahlungspflichtig buchen" : "Jetzt buchen"}</button>
    </form >;
}
