"use client";
import { RatingSummary } from "@/components/rating-summary";
import { AccountStatusTag } from "@/components/account-status-tag";

import { ResendAssignment } from "@/components/resend-assignment";
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteTrainer, saveTrainer } from "../actions";
import type { TrainerRow, TrainerState, TrainerValues } from "@/lib/trainers/validation";

const primary = "rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-primary-500 dark:border-zinc-700";
const fields: { name: keyof TrainerValues; label: string; max: number }[] = [
  { name: "firstName", label: "Vorname", max: 160 }, { name: "lastName", label: "Nachname", max: 160 }, { name: "email", label: "E-Mail-Adresse", max: 254 },
];

function TrainerForm({ slug, row, onSaved, onCancel }: { slug: string; row?: TrainerRow; onSaved: (message: string) => void; onCancel: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = panel.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const open = () => {
      dialog.close();
      if (desktop.matches) dialog.show(); else dialog.showModal();
      dialog.querySelector<HTMLInputElement>("input")?.focus();
    };
    open(); desktop.addEventListener("change", open);
    return () => { desktop.removeEventListener("change", open); dialog.close(); previousFocus?.focus(); };
  }, []);
  const [state, action, pending] = useActionState<TrainerState, FormData>(async (previous, data) => {
    const result = await saveTrainer(slug, row?.id ?? null, previous, data);
    if (result.success) onSaved(result.message!);
    return result;
  }, {});
  return <dialog ref={panel} aria-labelledby="trainer-editor-title" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
    <form action={action} className="space-y-5">
      <header className="flex items-center justify-between gap-3"><h2 id="trainer-editor-title" className="font-semibold">{row ? "Trainer bearbeiten" : "Trainer erstellen"}</h2><button type="button" disabled={pending} onClick={onCancel} aria-label="Formular schließen" className="rounded p-2 text-xl">×</button></header>
      <fieldset disabled={pending} className="space-y-4">{fields.map(({ name, label, max }) => <div key={name}>
        <label htmlFor={`trainer-${name}`} className="text-sm">{label}</label>
        <input id={`trainer-${name}`} name={name} type={name === "email" ? "email" : "text"} defaultValue={row?.[name] ?? ""} required maxLength={max} aria-invalid={!!state.errors?.[name]} aria-describedby={state.errors?.[name] ? `trainer-error-${name}` : undefined} className={input} />
        {state.errors?.[name] && <p id={`trainer-error-${name}`} className="mt-1 text-xs text-red-700 dark:text-red-300">{state.errors[name]?.join(" ")}</p>}
      </div>)}</fieldset>
      <p className="text-xs text-zinc-500">Trainer können ohne Benutzeraccount angelegt werden. Es wird keine Einladung versendet.</p>
      {state.message && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.message}</p>}
      <div className="flex gap-3"><button disabled={pending} className={primary}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending} onClick={onCancel} className="text-sm underline">Abbrechen</button></div>
    </form>
  </dialog>;
}

function DeleteTrainer({ slug, row, onDeleted }: { slug: string; row: TrainerRow; onDeleted: (message: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<TrainerState, FormData>(async (previous, data) => {
    const result = await deleteTrainer(slug, row.id, previous, data);
    if (result.success) onDeleted(result.message!);
    return result;
  }, {});
  const used = row._count.events > 0 || row._count.suggestedForSeries > 0;
  return <div className="max-w-64">{confirming ? <form action={action} className="space-y-2">
    <p>„{row.firstName} {row.lastName}“ endgültig löschen?</p><input type="hidden" name="confirmed" value="yes" />
    <div className="flex gap-3"><button disabled={pending} className="text-red-700 underline dark:text-red-300">{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline">Abbrechen</button></div>
  </form> : <button type="button" disabled={used} title={used ? "Dieser Trainer wird noch verwendet." : "Trainer löschen"} aria-label={`${row.firstName} ${row.lastName} löschen`} onClick={() => setConfirming(true)} className="rounded-lg p-2 text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg></button>}
    {state.message && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{state.message}</p>}
  </div>;
}

export function TrainersTable({ company, trainers }: { company: { name: string; slug: string }; trainers: TrainerRow[] }) {
  const [editor, setEditor] = useState<{ row?: TrainerRow } | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const visible = trainers.filter((row) => [row.number, row.firstName, row.lastName, row.email].join(" ").toLocaleLowerCase("de-DE").includes(query.trim().toLocaleLowerCase("de-DE")));
  const saved = (message: string) => { setEditor(null); setMessage(message); };
  return <main className={`flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black ${editor ? "xl:mr-96" : ""}`}>
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Trainer</h1><p className="mt-1 text-sm text-zinc-500">{company.name}</p></div><button type="button" disabled={!!editor} onClick={() => { setEditor({}); setMessage(""); }} className={primary}>+ Trainer erstellen</button></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    {editor && <TrainerForm key={editor.row?.id ?? "new"} slug={company.slug} row={editor.row} onSaved={saved} onCancel={() => setEditor(null)} />}
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4"><label><span className="sr-only">Trainer durchsuchen</span><input type="search" placeholder="Trainer durchsuchen …" value={query} onChange={(event) => setQuery(event.target.value)} className={input} /></label><span className="text-sm text-zinc-500">{visible.length} von {trainers.length} Trainer</span></div>
      <table className="w-full text-left text-sm"><caption className="sr-only">Trainer von {company.name}</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Nr.", "Vorname", "Nachname", "E-Mail-Adresse", "Account-Status", "Veranstaltungen", "Veranstaltungsreihen", "Bewertung", "Aktionen"].map((label) => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
          <td className="px-4 py-4">{row.number}</td><td className="px-4 py-4">{row.firstName}</td><th scope="row" className="px-4 py-4 font-medium">{row.lastName}</th><td className="px-4 py-4">{row.email}</td>
          <td className="px-4 py-4"><AccountStatusTag status={row.accountStatus} /></td>
          <td className="px-4 py-4">{row._count.events}</td><td className="px-4 py-4">{row._count.suggestedForSeries}</td>
          <td className="px-4 py-4"><RatingSummary rating={row.rating} /></td>
    <td className="px-4 py-4"><div className="flex items-start gap-2"><button type="button" disabled={!!editor} title="Trainer bearbeiten" aria-label={`${row.firstName} ${row.lastName} bearbeiten`} onClick={() => { setEditor({ row }); setMessage(""); }} className="rounded-lg p-2 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5" /></svg></button>{row.accountStatus !== "verified" && <ResendAssignment kind="trainer" slug={company.slug} id={row.id} iconOnly />}{!editor && <DeleteTrainer slug={company.slug} row={row} onDeleted={setMessage} />}</div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="p-8 text-center text-sm text-zinc-500">{trainers.length ? "Keine passenden Trainer gefunden." : "Noch keine Trainer vorhanden. Erstelle den ersten Trainer über den Button oben."}</p>}
    </div>
    <p className="text-xs text-zinc-500">Trainer mit zugeordneten Veranstaltungen oder Veranstaltungsreihen können nicht gelöscht werden.</p>
  </main>;
}
