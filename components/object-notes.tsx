"use client";
import { UnsavedChangesForm } from "@/components/unsaved-changes";

import { useEffect, useId, useRef, useState } from "react";
import { createNote, deleteNote, listNotes, updateNote } from "@/app/company/notes/actions";
import type { NoteTarget } from "@/lib/notes/validation";
import type { listNotes as loadNotes } from "@/lib/notes/service";

type Note = Awaited<ReturnType<typeof loadNotes>>[number];
export type NoteSummaries = { userId: string; counts: Record<string, number> };
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const button = "rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-50 dark:hover:bg-zinc-800";

function NoteForm({ note, target, onSaved, onCancel }: { note?: Note; target: NoteTarget; onSaved: (note: Note) => void; onCancel: () => void }) {
  const id = useId();
  const [body, setBody] = useState(note?.body ?? "");
  const [privateNote, setPrivate] = useState(note?.visibility === "PRIVATE");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  return <UnsavedChangesForm className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    if (locked.current || !body.trim()) return;
    locked.current = true; setPending(true); setError("");
    try {
      const content = { body, visibility: privateNote ? "PRIVATE" : "COMPANY" };
      const result = note ? await updateNote(note.id, content) : await createNote(target, content);
      if (result.success) { setBody(""); setPrivate(false); onSaved(result.data); }
      else setError(result.message);
    } catch { setError("Die Notiz konnte nicht gespeichert werden. Bitte versuche es erneut."); }
    finally { locked.current = false; setPending(false); }
  }}>
    <div><label htmlFor={id} className="text-sm">Notiztext</label><textarea autoFocus id={id} required rows={3} value={body} disabled={pending} onChange={event => setBody(event.target.value)} aria-describedby={error ? `${id}-error` : undefined} className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base focus:ring-2 focus:ring-primary-500 dark:border-zinc-700" /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privateNote} disabled={pending} onChange={event => setPrivate(event.target.checked)} />Private Notiz – nur für mich sichtbar</label>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex gap-2"><button disabled={pending || !body.trim()} className={`${button} bg-primary-600 text-white hover:bg-primary-700`}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending} className={button} data-discard-changes onClick={onCancel}>Abbrechen</button></div>
  </UnsavedChangesForm>;
}

function NoteItem({ note, target, userId, onChanged, onDeleted }: { note: Note; target: NoteTarget; userId: string; onChanged: (note: Note) => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  return <li className="border-b border-zinc-200 py-4 last:border-0 dark:border-zinc-800">
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400"><details><summary className="cursor-pointer rounded focus-visible:outline-2">{note.author.name || note.author.email}</summary><a className="underline" href={`mailto:${note.author.email}`}>{note.author.email}</a></details><time dateTime={new Date(note.createdAt).toISOString()}>{date.format(new Date(note.createdAt))} Uhr (Berlin)</time>{note.visibility === "PRIVATE" && <span className="inline-flex items-center gap-1"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Privat</span>}{new Date(note.updatedAt).getTime() > new Date(note.createdAt).getTime() && <span title={date.format(new Date(note.updatedAt))}>Bearbeitet</span>}</div>
      {note.author.id === userId && !editing && <details className="relative shrink-0"><summary aria-label={`Aktionen für Notiz ${note.number}`} className={`${button} cursor-pointer list-none`}>⋯</summary><div className="absolute right-0 z-10 min-w-32 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"><button className={`${button} w-full text-left`} onClick={() => { setEditing(true); setConfirming(false); }}>Bearbeiten</button><button className={`${button} w-full text-left text-red-700 dark:text-red-300`} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setConfirming(true); }}>Löschen</button></div></details>}
    </div>
    {editing ? <NoteForm note={note} target={target} onCancel={() => setEditing(false)} onSaved={updated => { setEditing(false); onChanged(updated); }} /> : <p className="whitespace-pre-wrap break-words text-base [overflow-wrap:anywhere]">{note.body}</p>}
    {confirming && <div className="mt-3 text-sm"><p>Diese Notiz endgültig löschen?</p><button disabled={pending} className={`${button} text-red-700 dark:text-red-300`} onClick={async () => {
      if (locked.current) return;
      locked.current = true; setPending(true); setError("");
      try { const result = await deleteNote(note.id); if (result.success) onDeleted(); else setError(result.message); }
      catch { setError("Die Notiz konnte nicht gelöscht werden. Bitte versuche es erneut."); }
      finally { locked.current = false; setPending(false); }
    }}>{pending ? "Wird gelöscht …" : "Löschen bestätigen"}</button><button disabled={pending} className={button} onClick={() => { setConfirming(false); setError(""); }}>Abbrechen</button>{error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}</div>}
  </li>;
}

function NoteList({ target, userId, onCount }: { target: NoteTarget; userId: string; onCount: (count: number) => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const countCallback = useRef(onCount);
  useEffect(() => { countCallback.current = onCount; }, [onCount]);
  useEffect(() => {
    let active = true; setError("");
    listNotes({ type: target.type, id: target.id }).then(result => {
      if (!active) return;
      if (result.success) { setNotes(result.data); countCallback.current(result.data.length); }
      else { setNotes(null); setError(result.message); }
    }).catch(() => { if (active) setError("Die Notizen konnten nicht geladen werden."); });
    return () => { active = false; };
  }, [target.type, target.id, attempt]);
  useEffect(() => { if (notes !== null) countCallback.current(notes.length); }, [notes]);
  function changed(update: (current: Note[]) => Note[]) {
    setNotes(current => current === null ? null : update(current));
  }
  return <div>
    {error ? <p role="alert" className="py-3 text-sm">{error} <button className="underline" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</button></p> : notes === null ? <p role="status" className="py-3 text-sm text-zinc-500">Notizen werden geladen …</p> : <>
      {!notes.length && <p className="py-4 text-sm text-zinc-500">Noch keine sichtbaren Notizen vorhanden.</p>}
      <ul ref={list} className="max-h-[50dvh] overflow-y-auto overscroll-contain pr-2" aria-label="Notizen">{notes.map(note => <NoteItem key={note.id} note={note} target={target} userId={userId} onChanged={updated => changed(current => current.map(item => item.id === updated.id ? updated : item))} onDeleted={() => changed(current => current.filter(item => item.id !== note.id))} />)}</ul>
      <div className="mt-3">{adding ? <NoteForm target={target} onCancel={() => setAdding(false)} onSaved={note => { changed(current => [...current, note]); setAdding(false); requestAnimationFrame(() => { const element = list.current; if (element) element.scrollTop = element.scrollHeight; }); }} /> : <button className={`${button} text-primary-700 dark:text-primary-300`} onClick={() => setAdding(true)}>Notiz hinzufügen</button>}</div>
    </>}
  </div>;
}

function NotesDialog({ target, label, userId, onClose, onCount }: { target: NoteTarget; label: string; userId: string; onClose: () => void; onCount: (count: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-2xl backdrop:bg-black/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
    <div className="flex max-h-[calc(100dvh-2rem)] flex-col"><header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 p-4 dark:border-zinc-800"><div><h2 id={title} className="text-lg font-semibold">Notizen</h2><p className="break-words text-sm text-zinc-500">{label}</p></div><button autoFocus type="button" className={button} aria-label="Notizen schließen" data-discard-changes onClick={onClose}>×</button></header><div className="overflow-y-auto overscroll-contain p-4"><NoteList target={target} userId={userId} onCount={onCount} /></div></div>
  </dialog>;
}

export function ObjectNotes({ target, label, userId, initialCount, mode = "section" }: { target: NoteTarget; label: string; userId: string; initialCount: number; mode?: "section" | "dialog" }) {
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  if (mode === "dialog") return <><button type="button" className={`${button} inline-flex items-center gap-1 tabular-nums`} aria-label={`Notizen für ${label}: ${count} sichtbare Notizen`} onClick={() => setOpen(true)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 3h16v14h-9l-7 4Z" /><path d="M8 7h8M8 11h6" /></svg><span>{count}</span></button>{open && <NotesDialog target={target} label={label} userId={userId} onClose={() => setOpen(false)} onCount={setCount} />}</>;
  return <details className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" onToggle={event => setOpen(event.currentTarget.open)}><summary className="cursor-pointer rounded-xl p-4 font-medium focus-visible:outline-2 focus-visible:outline-primary-600">Notizen ({count})</summary><div className="px-4 pb-4">{open && <NoteList target={target} userId={userId} onCount={setCount} />}</div></details>;
}
