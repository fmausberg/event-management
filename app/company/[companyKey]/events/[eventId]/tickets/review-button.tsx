"use client";
import { useActionState, useRef } from "react";
import { sendTicketReviewInvitation } from "./review-actions";
export function ReviewButton({ slug, eventId, ticketId, unavailable }: { slug: string; eventId: string; ticketId: string; unavailable: string | null }) {
  const requestId = useRef<string | null>(null);
  const [state, action, pending] = useActionState(async () => {
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await sendTicketReviewInvitation(slug, eventId, ticketId, requestId.current);
      // Keep the id after ambiguous network failures; a successful new click is a new request.
      if (result.queued) requestId.current = null;
      return result;
    } catch {
      return { message: "Verbindung unterbrochen. Bitte erneut versuchen." };
    }
  }, { message: "" });
  return <form action={action} className="min-w-48 space-y-2">
    <button disabled={pending || !!unavailable} className="rounded-lg bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-50">{pending ? "Wird versendet …" : "Bewertungsaufforderung senden"}</button>
    {unavailable && <p className="text-xs text-zinc-500">{unavailable}</p>}
    {state.message && <p role="status" className="text-xs">{state.message}</p>}
  </form>;
}
