"use client";

import { useEffect, useRef } from "react";

export function PublishConfirmation({ missing, onDecision }: { missing: string[]; onDecision: (publish: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    back.current?.focus();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="publish-confirm-title" aria-describedby="publish-confirm-description" onCancel={(event) => { event.preventDefault(); onDecision(false); }} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-primary-100 bg-white p-0 text-zinc-950 shadow-2xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
    <div className="h-1.5 bg-primary-600" />
    <div className="p-6 sm:p-8">
      <div className="mb-5 flex items-center justify-between">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></svg>
        </span>
        <button type="button" aria-label="Zurück zum Formular" onClick={() => onDecision(false)} className="rounded-lg px-3 py-1 text-2xl text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-primary-600 dark:hover:bg-zinc-800">×</button>
      </div>
      <h2 id="publish-confirm-title" className="text-xl font-semibold tracking-tight">Noch etwas ergänzen?</h2>
      <p id="publish-confirm-description" className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">Dein Event ist bereit zur Veröffentlichung. Diese optionalen Angaben fehlen noch:</p>
      <ul className="my-5 space-y-2 rounded-xl border border-primary-100 bg-primary-50/60 p-4 dark:border-zinc-700 dark:bg-zinc-800">
        {missing.map((label) => <li key={label} className="flex items-center gap-3 text-sm font-medium"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-500" />{label}</li>)}
      </ul>
      <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Du kannst sie jetzt ergänzen oder dein Event bereits veröffentlichen.</p>
      <div className="mt-6 flex flex-col gap-3">
        <button ref={back} type="button" onClick={() => onDecision(false)} className="rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">Angaben ergänzen</button>
        <button type="button" onClick={() => onDecision(true)} className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-primary-600 dark:border-zinc-600 dark:hover:bg-zinc-800">Trotzdem veröffentlichen</button>
      </div>
    </div>
  </dialog>;
}
