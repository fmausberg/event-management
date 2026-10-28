"use client";
import { useActionState } from "react";
import { resendTicketEmail } from "@/app/account/tickets/actions";

export function ResendTicketEmail({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(resendTicketEmail, {});
  return <form action={action} className="space-y-2">
    <input type="hidden" name="ticketId" value={ticketId} />
    <button disabled={pending} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">{pending ? "Wird versendet …" : "Tickets der Buchung erneut per E-Mail senden"}</button>
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}
