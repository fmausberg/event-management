"use client";

import { useActionState, useState } from "react";
import { deleteEvent } from "../actions";

export function DeleteEventButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteEvent.bind(null, id), {});

  return (
    <div>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} aria-label={`${name} löschen`} className="text-red-700 underline dark:text-red-400">Löschen</button>
      ) : (
        <form action={formAction} className="space-y-2">
          <p>Event wirklich löschen?</p>
          <input type="hidden" name="confirmed" value="yes" />
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="text-red-700 underline disabled:opacity-50 dark:text-red-400">{pending ? "Wird gelöscht …" : "Ja, löschen"}</button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline disabled:opacity-50">Abbrechen</button>
          </div>
        </form>
      )}
      <p role="status" aria-live="polite" className="mt-1 max-w-xs text-sm text-red-700 dark:text-red-400">{state.message}</p>
    </div>
  );
}
