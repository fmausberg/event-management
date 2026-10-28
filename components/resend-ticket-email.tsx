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
    <button disabled={pending || !!props.unavailableReason || (!!state.success && !another)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">{pending ? "Wird beauftragt …" : "Tickets erneut senden"}</button>
    {props.unavailableReason && <p className="text-xs text-zinc-500">{props.unavailableReason}</p>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
    {state.success && !pending && !another && !props.unavailableReason && <button type="button" className="text-xs underline" onClick={() => { requestId.current = null; setAnother(true); }}>Weiteren Versand vorbereiten</button>}
  </form>;
}
