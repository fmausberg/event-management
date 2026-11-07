"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SeriesRow, VenueOption } from "@/lib/event-series/validation";
import type { TrainerOption } from "@/lib/trainers/validation";
import { SeriesForm } from "./series-table";

export function SeriesDetails({ slug, row, venues, trainers, canManage }: {
  slug: string; row: SeriesRow; venues: VenueOption[]; trainers: TrainerOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  function closeEditor() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return <>
    <header><h1 className="text-2xl font-semibold">{row.name}</h1></header>
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    <details ref={panel} open className="relative rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer rounded-xl p-4 pr-16 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Details
      {canManage && <button ref={editButton} type="button" disabled={editing} aria-label="Details bearbeiten" title="Details bearbeiten" onClick={event => { event.preventDefault(); event.stopPropagation(); if (panel.current) panel.current.open = true; setMessage(""); setEditing(true); }} className="absolute right-3 top-2 rounded-lg p-3 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5" /></svg></button>}</summary>
      <div className="border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">
        <SeriesForm key={editing ? "edit" : "read"} inline readOnly={!editing} slug={slug} row={row} venues={venues} trainers={trainers} onCancel={closeEditor} onSaved={text => { closeEditor(); setMessage(text); router.refresh(); }} />
      </div>
    </details>
  </>;
}
