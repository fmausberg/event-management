"use client";

import { useEffect, useRef } from "react";

export function VenueUpdateConfirmation({ eventCount, onDecision }: { eventCount: number; onDecision: (save: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    back.current?.focus();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="venue-update-confirm-title" aria-describedby="venue-update-confirm-description" onCancel={(event) => { event.preventDefault(); onDecision(false); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-primary-100 bg-white p-0 text-zinc-950 shadow-2xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
    <div className="h-1.5 bg-primary-600" />
    <div className="p-6 sm:p-8">
      <div className="mb-5 flex items-center justify-between">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>
        </span>
        <button type="button" aria-label="Zurück zum Formular" onClick={() => onDecision(false)} className="rounded-lg px-3 py-1 text-2xl text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-primary-600 dark:hover:bg-zinc-800">×</button>
      </div>
      <h2 id="venue-update-confirm-title" className="text-xl font-semibold tracking-tight">Änderung für alle Veranstaltungen?</h2>
      <p id="venue-update-confirm-description" className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">Dieser Ort wird von {eventCount} {eventCount === 1 ? "Veranstaltung verwendet" : "Veranstaltungen verwendet"}.</p>
      <p className="my-5 rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm leading-relaxed dark:border-zinc-700 dark:bg-zinc-800">Alle verknüpften Veranstaltungen zeigen nach dem Speichern die geänderten Ortsdaten, auch bereits bestehende oder vergangene Veranstaltungen.</p>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Wenn das nicht gewollt ist, lege stattdessen einen neuen Ort an und ordne sie nur den gewünschten Veranstaltungen zu.</p>
      <div className="mt-6 flex flex-col gap-3">
        <button ref={back} type="button" onClick={() => onDecision(false)} className="rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">Zurück zum Bearbeiten</button>
        <button type="button" onClick={() => onDecision(true)} className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-primary-600 dark:border-zinc-600 dark:hover:bg-zinc-800">Änderung für alle übernehmen</button>
      </div>
    </div>
  </dialog>;
}
