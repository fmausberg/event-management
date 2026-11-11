"use client";
import { useActionState, useRef, useState } from "react";
import { resendTicketEmail } from "@/app/account/tickets/actions";
import { resendCompanyTickets } from "@/app/company/[companyKey]/events/[eventId]/bookings/mail-actions";
import type { TicketMailState } from "@/lib/tickets/resend";

type Props = { unavailableReason?: string | null } & ({ ticketId: string } | { companySlug: string; eventId: string; bookingId: string });
export function ResendTicketEmail(props: Props) {
  // Retain request ID through failures and success until an explicit new intent.
  const requestId = useRef<string | null>(null);
  const [another, setAnother] = useState(false);
  const [state, action, pending] = useActionState<TicketMailState, FormData>(async (previous, form) => {
    requestId.current ??= crypto.randomUUID();
    form.set("requestId", requestId.current);
    setAnother(false);
    return "ticketId" in props ? resendTicketEmail(previous, form) : resendCompanyTickets(props.companySlug, props.eventId, props.bookingId, previous, form);
  }, {});
  return <form action={action} className="space-y-2">
    {"ticketId" in props && <input type="hidden" name="ticketId" value={props.ticketId} />}
    <button type="submit" disabled={pending || !!props.unavailableReason || (!!state.success && !another)} aria-label={pending ? "Tickets werden gesendet" : "Tickets erneut senden"} aria-busy={pending} title={props.unavailableReason ?? (pending ? "Tickets werden gesendet" : state.success && !another ? "Tickets wurden gesendet" : "Tickets erneut senden")} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 ${pending ? "animate-pulse motion-reduce:animate-none" : ""}`}>
        {state.success && !another ? <path d="m5 12 4 4L19 6" /> : <><path d="M20 10V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M2 5l9 6 9-6" /><path d="M15 15a4 4 0 1 1-1 4M15 12v3h3" /></>}
      </svg>
    </button>
    {props.unavailableReason && <p className="text-xs text-zinc-500">{props.unavailableReason}</p>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
    {state.success && !pending && !another && !props.unavailableReason && <button type="button" className="text-xs underline" onClick={() => { requestId.current = null; setAnother(true); }}>Weiteren Versand vorbereiten</button>}
  </form>;
}
