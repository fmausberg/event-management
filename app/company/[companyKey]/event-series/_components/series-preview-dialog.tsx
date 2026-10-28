"use client";
import { useEffect, useRef, useState } from "react";
import type { SeriesAttribute, SeriesPreview } from "@/lib/event-series/preview";

export function SeriesPreviewDialog({ preview, pending, message, onApply, onCancel }: {
  preview: SeriesPreview; pending: boolean; message?: string;
  onApply: (selection: Record<string, string[]>) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(preview.tabs[0].key);
  const [visited, setVisited] = useState<SeriesAttribute[]>([active]);
  const [selection, setSelection] = useState(() => Object.fromEntries(preview.tabs.map((tab) => [tab.key, tab.rows.map((row) => row.id)])));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  function visit(key: SeriesAttribute) { setActive(key); setVisited((old) => old.includes(key) ? old : [...old, key]); }
  const tab = preview.tabs.find((tab) => tab.key === active)!;
  return <dialog ref={dialog} aria-labelledby="series-preview-title" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-primary-100 bg-white p-6 text-zinc-950 shadow-2xl backdrop:bg-zinc-950/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 id="series-preview-title" className="text-lg font-semibold">Änderungen auf zukünftige Events übertragen</h2><button type="button" disabled={pending} onClick={() => setVisited(preview.tabs.map((tab) => tab.key))} className="text-sm text-primary-700 underline dark:text-primary-300">Alle Vorschauen ansehen</button></header>
    <p className="my-3 text-sm text-zinc-500">Prüfe jedes Attribut. Nur ausgewählte Event-Werte werden ersetzt. Datumsangaben: Europe/Berlin.</p>
    <div role="tablist" aria-label="Geänderte Attribute" className="flex gap-2 overflow-x-auto border-b border-zinc-200 pb-2 dark:border-zinc-700">
      {preview.tabs.map((item, index) => <button key={item.key} id={`preview-tab-${item.key}`} type="button" role="tab" aria-selected={active === item.key} aria-controls={`preview-panel-${item.key}`} tabIndex={active === item.key ? 0 : -1} onClick={() => visit(item.key)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % preview.tabs.length : event.key === "ArrowLeft" ? (index + preview.tabs.length - 1) % preview.tabs.length : event.key === "Home" ? 0 : event.key === "End" ? preview.tabs.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); visit(preview.tabs[next].key); document.getElementById(`preview-tab-${preview.tabs[next].key}`)?.focus(); }
      }} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${active === item.key ? "bg-primary-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{item.label}{visited.includes(item.key) && <span aria-label="angesehen"> ✓</span>}</button>)}
    </div>
    <div role="tabpanel" id={`preview-panel-${tab.key}`} aria-labelledby={`preview-tab-${tab.key}`} tabIndex={0} className="my-4 max-h-[45dvh] overflow-auto">
      {tab.rows.length ? <table className="w-full text-left text-sm"><caption className="sr-only">{tab.label}: zukünftige Events</caption><thead><tr>{["Auswahl", "Event-Datum", "Bisheriger Wert", "Neuer Wert"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{tab.rows.map((row) => <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-700"><td className="p-2"><input type="checkbox" disabled={pending} aria-label={`${tab.label} für ${row.date} übernehmen`} checked={selection[tab.key].includes(row.id)} onChange={(event) => setSelection((old) => ({ ...old, [tab.key]: event.target.checked ? [...old[tab.key], row.id] : old[tab.key].filter((id) => id !== row.id) }))} /></td><td className="p-2 whitespace-nowrap">{row.date}</td><td className="max-w-60 whitespace-pre-wrap break-words p-2">{selection[tab.key].includes(row.id) ? row.before : <strong className="font-bold">{row.before}</strong>}</td><td className="max-w-60 whitespace-pre-wrap break-words p-2">{selection[tab.key].includes(row.id) ? <strong className="font-bold">{row.after}</strong> : row.after}</td></tr>)}</tbody></table> : <p className="py-6 text-sm text-zinc-500">Für dieses Attribut gibt es keine betroffenen zukünftigen Events.</p>}
    </div>
    {message && <p role="alert" className="my-3 text-sm text-red-700 dark:text-red-300">{message}</p>}
    <p aria-live="polite" className="mb-3 text-xs text-zinc-500">{visited.length} von {preview.tabs.length} Vorschauen angesehen.</p>
    <footer className="flex gap-3"><button type="button" disabled={pending || visited.length !== preview.tabs.length} onClick={() => onApply(selection)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Wird gespeichert …" : "Übernehmen"}</button><button type="button" disabled={pending} onClick={onCancel} className="text-sm underline">Abbrechen</button></footer>
  </dialog>;
}
