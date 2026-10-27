"use client";
import { useActionState } from "react";
import { cancellationAction } from "@/app/account/bookings/actions";

export function CancellationActionForm({ id, intent, label, noteLabel }: { id: string; intent: "free" | "request" | "withdraw" | "approve" | "reject" | "retry" | "decide"; label: string; noteLabel?: string }) {
  const [state, action, pending] = useActionState(cancellationAction, {});
  return <form action={action} className="mt-3 space-y-2">
    <input type="hidden" name="id" value={id} />{intent !== "decide" && <input type="hidden" name="intent" value={intent} />}
    <fieldset disabled={pending} className="space-y-2">
      {noteLabel && <label className="block text-sm">{noteLabel}<textarea name="note" maxLength={2000} rows={2} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700" /></label>}
      {(intent === "approve" || intent === "free") && <p className="text-xs text-zinc-500">Alle Plätze und Tickets dieser Buchung werden storniert. Eine vorhandene Onlinezahlung wird vollständig erstattet; die Erstattung kann noch ausstehen.</p>}
      {intent === "decide" && <p className="text-xs text-zinc-500">Bei Genehmigung werden alle Plätze und Tickets storniert und eine vorhandene Onlinezahlung vollständig erstattet. Die Erstattung kann noch ausstehen. Bei Ablehnung bleibt die Buchung unverändert.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" required />{label} bestätigen</label>
      {intent === "decide" ? <div className="flex flex-wrap gap-3">
        <button type="submit" name="intent" value="approve" className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{pending ? "Wird verarbeitet …" : "Genehmigen und stornieren"}</button>
        <button type="submit" name="intent" value="reject" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Anfrage ablehnen</button>
      </div> : <button className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">{pending ? "Wird verarbeitet …" : label}</button>}
    </fieldset>
    {state.message && <p role="status" className={`text-sm ${state.success ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
