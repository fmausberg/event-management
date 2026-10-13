"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteVenue, saveVenue } from "../actions";
import type { VenueRow, VenueState, VenueValues } from "@/lib/venues/validation";
const primary = "rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50";
const fields: { name: keyof VenueValues; label: string; max: number }[] = [
 { name: "name", label: "Name", max: 160 }, { name: "addressLine1", label: "Adresszeile 1", max: 250 },
 { name: "addressLine2", label: "Adresszeile 2", max: 250 }, { name: "postalCode", label: "Postleitzahl", max: 32 },
 { name: "city", label: "Ort", max: 160 }, { name: "countryCode", label: "Ländercode (z. B. DE)", max: 2 },
];
function VenueForm({ slug, row, onSaved, onCancel }: { slug: string; row?: VenueRow; onSaved: (message: string) => void; onCancel: () => void }) {
 const panel = useRef<HTMLDialogElement>(null);
 useEffect(() => {
  const dialog = panel.current!;
  const previousFocus = document.activeElement as HTMLElement | null;
  const desktop = window.matchMedia("(min-width: 1280px)");
  function open() {
   dialog.close();
   if (desktop.matches) dialog.show(); else dialog.showModal();
   dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }
  open();
  desktop.addEventListener("change", open);
  return () => { desktop.removeEventListener("change", open); dialog.close(); previousFocus?.focus(); };
 }, []);
 const [state, action, pending] = useActionState<VenueState, FormData>(async (previous, data) => {
  const result = await saveVenue(slug, row?.id ?? null, previous, data);
  if (result.success) onSaved(result.message!);
  return result;
 }, {});
 return <dialog ref={panel} aria-labelledby="venue-editor-title" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
 <form action={action} className="space-y-5 p-6">
  <header className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800"><h2 id="venue-editor-title" className="font-semibold">{row ? "Venue bearbeiten" : "Venue erstellen"}</h2><button type="button" disabled={pending} onClick={onCancel} aria-label="Formular schließen" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-violet-600 dark:hover:bg-zinc-800"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
  <fieldset disabled={pending} className="grid gap-4">{fields.map(({ name, label, max }) => <div key={name}>
   <label htmlFor={`venue-${name}`} className="text-sm">{label}</label>
   <input id={`venue-${name}`} name={name} defaultValue={row?.[name] ?? ""} required={name === "name"} maxLength={max} aria-invalid={!!state.errors?.[name]} aria-describedby={state.errors?.[name] ? `error-${name}` : undefined} className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700" />
   {state.errors?.[name] && <p id={`error-${name}`} className="mt-1 text-xs text-red-700 dark:text-red-300">{state.errors[name]?.join(" ")}</p>}
  </div>)}</fieldset>
  {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
  <div className="flex gap-3"><button disabled={pending} className={primary}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending} onClick={onCancel} className="text-sm underline">Abbrechen</button></div>
 </form></dialog>;
}
function DeleteVenue({ slug, row, onDeleted }: { slug: string; row: VenueRow; onDeleted: (message: string) => void }) {
 const [confirming, setConfirming] = useState(false);
 const [state, action, pending] = useActionState<VenueState, FormData>(async (previous, data) => {
  const result = await deleteVenue(slug, row.id, previous, data);
  if (result.success) onDeleted(result.message!);
  return result;
 }, {});
 const used = row._count.events > 0 || row._count.suggestedForSeries > 0;
 return <div className="max-w-64">{confirming ? <form action={action} className="space-y-2"><p>„{row.name}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" /><div className="flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline">Abbrechen</button></div></form> : <button type="button" disabled={used} title={used ? "Diese Venue wird noch von Events oder Eventserien verwendet." : "Venue löschen"} aria-label={`${row.name} löschen`} onClick={() => setConfirming(true)} className="text-red-700 underline disabled:opacity-40 dark:text-red-300">Löschen</button>}{state.message && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{state.message}</p>}</div>;
}
export function VenuesTable({ company, venues }: { company: { name: string; slug: string }; venues: VenueRow[] }) {
 const [editor, setEditor] = useState<{ row?: VenueRow } | null>(null);
 const [query, setQuery] = useState("");
 const [message, setMessage] = useState("");
 const visible = venues.filter((row) => [row.number, row.name, row.addressLine1, row.addressLine2, row.postalCode, row.city, row.countryCode].join(" ").toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
 function saved(message: string) { setEditor(null); setMessage(message); }
 return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-96" : ""}`}>
  <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Venues</h1><p className="mt-1 text-sm text-zinc-500">{company.name}</p></div><button type="button" disabled={!!editor} onClick={() => { setEditor({}); setMessage(""); }} className={primary}>+ Venue erstellen</button></header>
  {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
  {editor && <VenueForm key={editor.row?.id ?? "new"} slug={company.slug} row={editor.row} onSaved={saved} onCancel={() => setEditor(null)} />}
  <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
   <div className="flex flex-wrap items-center justify-between gap-3 p-4"><label><span className="sr-only">Venues durchsuchen</span><input type="search" placeholder="Venues durchsuchen …" value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700" /></label><span className="text-sm text-zinc-500">{visible.length} von {venues.length} Venues</span></div>
   <table className="w-full text-left text-sm"><caption className="sr-only">Venues von {company.name}</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Nr.", "Venue", "Adresse", "Events", "Eventserien", "Aktionen"].map((label) => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
    <td className="px-4 py-4">{row.number}</td><th scope="row" className="px-4 py-4 font-medium">{row.name}</th>
    <td className="px-4 py-4">{[row.addressLine1, row.addressLine2, [row.postalCode, row.city].filter(Boolean).join(" "), row.countryCode].filter(Boolean).join(", ") || "—"}</td>
    <td className="px-4 py-4">{row._count.events}</td><td className="px-4 py-4">{row._count.suggestedForSeries}</td>
    <td className="px-4 py-4"><div className="flex flex-wrap gap-3"><button type="button" disabled={!!editor} aria-label={`${row.name} bearbeiten`} onClick={() => { setEditor({ row }); setMessage(""); }} className="text-violet-700 underline disabled:opacity-40 dark:text-violet-300">Bearbeiten</button>{!editor && <DeleteVenue slug={company.slug} row={row} onDeleted={setMessage} />}</div></td>
   </tr>)}</tbody></table>
   {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{venues.length ? "Keine passenden Venues gefunden." : "Noch keine Venues vorhanden. Erstelle die erste Venue über den Button oben."}</p>}
  </div>
  <p className="text-xs text-zinc-500">Venues mit zugeordneten Events oder Eventserien können nicht gelöscht werden.</p>
 </main>;
}
