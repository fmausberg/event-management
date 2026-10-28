"use client";

import { useId, useState } from "react";
import { CancellationActionForm } from "@/components/cancellation-action-form";

export function BookingCancellation({ id, free }: { id: string; free: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <div>
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800">{open ? "Formular schließen" : "Stornieren"}</button>
    <div id={panelId} hidden={!open}>
      {open && <div className="mt-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
        <p className="text-sm">{free ? "Du kannst diese Buchung jetzt kostenfrei stornieren." : "Die kostenfreie Selbststornierung ist nicht möglich. Du kannst eine Anfrage an den Veranstalter senden."} Die Stornierung gilt für alle Tickets dieser Buchung.</p>
        <CancellationActionForm id={id} intent={free ? "free" : "request"} label={free ? "Kostenfrei stornieren" : "Stornierung anfragen"} noteLabel="Hinweis / Grund (optional)" />
      </div>}
    </div>
  </div>;
}
