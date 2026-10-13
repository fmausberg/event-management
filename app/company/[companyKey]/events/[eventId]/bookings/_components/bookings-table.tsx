"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveBooking, deleteBooking } from "../actions";
import type { BookingRow, BookingState } from "@/lib/bookings/validation";
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700";
const primary = "rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50";
function BookingForm({ slug, eventId, row, onSaved, onCancel }: { slug: string; eventId: string; row?: BookingRow; onSaved: (message: string) => void; onCancel: () => void }) {
    const panel = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = panel.current!; const previous = document.activeElement as HTMLElement | null;
        const desktop = window.matchMedia("(min-width: 1280px)");
        const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLInputElement>("input")?.focus(); };
        open(); desktop.addEventListener("change", open);
        return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
    }, []);
    const [state, action, pending] = useActionState<BookingState, FormData>(async (previous, form) => { const result = await saveBooking(slug, eventId, row?.id ?? null, previous, form); if (result.success) onSaved(result.message!); return result; }, {});
    return <dialog ref={panel} aria-labelledby="booking-form-title" onCancel={(e) => { e.preventDefault(); if (!pending) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
        <form action={action} className="space-y-5"><header className="flex items-center justify-between"><h2 id="booking-form-title" className="font-semibold">{row ? "Buchung bearbeiten" : "Buchung erstellen"}</h2><button type="button" disabled={pending} onClick={onCancel} aria-label="Formular schließen" className="p-2 text-xl">×</button></header>
            <fieldset disabled={pending} className="space-y-4">
                <div><label htmlFor="booking-name">Name</label><input id="booking-name" name="customerName" defaultValue={row?.customerName ?? ""} maxLength={160} className={input} /></div>
                <div><label htmlFor="booking-email">E-Mail-Adresse</label><input id="booking-email" name="customerEmail" type="email" defaultValue={row?.customerEmail ?? ""} maxLength={254} className={input} /></div>
                <div><label htmlFor="booking-quantity">Anzahl Plätze</label><input id="booking-quantity" name="quantity" type="number" min={1} max={2147483647} step={1} required defaultValue={row?.quantity ?? 1} className={input} /></div>
                <div><label htmlFor="booking-status">Status</label><select id="booking-status" name="status" defaultValue={row?.status ?? "CONFIRMED"} className={input}><option value="CONFIRMED">Bestätigt</option><option value="CANCELLED">Storniert</option></select></div>
            </fieldset>
            <p className="text-xs text-zinc-500">Manuelle Buchungen sind auch ohne Benutzeraccount möglich. Es werden keine E-Mails versendet.</p>
            {row?.platform && <p className="text-xs text-zinc-500">Änderungen gelten lokal. Ein späterer Plattformimport kann sie überschreiben.</p>}
            {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
            <div className="flex gap-3"><button disabled={pending} className={primary}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending} onClick={onCancel} className="underline">Abbrechen</button></div>
        </form>
    </dialog>;
}
function RemoveBooking({ slug, eventId, row, onDeleted }: { slug: string; eventId: string; row: BookingRow; onDeleted: (message: string) => void }) {
    const [confirm, setConfirm] = useState(false);
    const [state, action, pending] = useActionState<BookingState, FormData>(async (previous, form) => { const result = await deleteBooking(slug, eventId, row.id, previous, form); if (result.success) onDeleted(result.message!); return result; }, {});
    return <div className="max-w-64">{confirm ? <form action={action}><p>Buchung #{row.number} endgültig löschen?</p>{row.platform && <p className="text-xs">Ein Plattformimport kann die Buchung erneut anlegen.</p>}<input type="hidden" name="confirmed" value="yes" /><div className="mt-2 flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirm(false)} className="underline">Abbrechen</button></div></form> : <button type="button" onClick={() => setConfirm(true)} aria-label={`Buchung ${row.number} löschen`} className="text-red-700 underline dark:text-red-300">Löschen</button>}{state.message && <p role="alert" className="text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
export function BookingsTable({ company, event, bookings }: { company: { name: string; slug: string }; event: { id: string; name: string; maxSeats: number; beginsAt: string }; bookings: BookingRow[] }) {
    const [editor, setEditor] = useState<{ row?: BookingRow } | null>(null);
    const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
    const visible = bookings.filter((b) => [b.number, b.customerName, b.customerEmail, b.externalBookingId, b.platform].join(" ").toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
    const seats = bookings.filter((b) => b.status === "CONFIRMED").reduce((sum, b) => sum + b.quantity, 0);
    return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-96" : ""}`}>
        <Link href={`/company/${encodeURIComponent(company.slug)}/events`} className="text-sm text-violet-700 underline dark:text-violet-300">Zur Eventübersicht</Link>
        <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
                <h1 className="text-2xl font-semibold">Buchungen - {event.name} ({new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(event.beginsAt))} Uhr)</h1>
                <p className="text-sm text-zinc-500">{company.name} · {seats} von {event.maxSeats} Plätzen belegt</p>
            </div>
            <button type="button" disabled={!!editor} onClick={() => { setEditor({}); setMessage(""); }} className={primary}>+ Buchung erstellen</button>
        </header>
        {message && <p role="status" className="text-green-700 dark:text-green-300">{message}</p>}
        {editor && <BookingForm key={editor.row?.id ?? "new"} slug={company.slug} eventId={event.id} row={editor.row} onCancel={() => setEditor(null)} onSaved={(text) => { setEditor(null); setMessage(text); }} />}
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><label><span className="sr-only">Buchungen durchsuchen</span><input type="search" placeholder="Buchungen durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} className={input} /></label><span className="text-sm text-zinc-500">{visible.length} von {bookings.length} Buchungen</span></div>
            <table className="w-full text-left text-sm">
                <caption className="sr-only">Buchungen für {event.name}</caption>
                <thead className="bg-zinc-100 dark:bg-zinc-900">
                    <tr>{["Nr.", "Name", "E-Mail", "Plätze", "Status", "Gebucht (Europe/Berlin)", "Quelle", "Aktionen"].map((label) =>
                        <th key={label} scope="col" className="px-4 py-3">{label}</th>
                    )}
                    </tr>
                </thead>
                <tbody>{visible.map((row) =>
                    <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                        <td className="px-4 py-4">{row.number}</td>
                        <th scope="row" className="px-4 py-4 font-medium">{row.customerName || "—"}</th>
                        <td className="px-4 py-4">{row.customerEmail || "—"}</td>
                        <td className="px-4 py-4">{row.quantity}</td>
                        <td className="px-4 py-4">{row.status === "CONFIRMED" ? "Bestätigt" : "Storniert"}</td>
                        <td className="whitespace-nowrap px-4 py-4">{new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(row.bookedAt))}</td><td className="px-4 py-4">{row.platform ?? "Intern"}{row.externalBookingId && <p className="text-xs text-zinc-500">{row.externalBookingId}</p>}</td>
                        <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-3">
                                <button disabled={!!editor} type="button" onClick={() => { setEditor({ row }); setMessage(""); }} className="text-violet-700 underline disabled:opacity-40 dark:text-violet-300">Bearbeiten</button>
                                {!editor && <RemoveBooking slug={company.slug} eventId={event.id} row={row} onDeleted={setMessage} />}
                            </div>
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
            {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{bookings.length ? "Keine passenden Buchungen gefunden." : "Noch keine Buchungen vorhanden. Erstelle die erste Buchung über den Button oben."}</p>}
        </div>
    </main>;
}
