"use client";

import { useActionState, useState } from "react";
import { respondToEventRoles, type TrainerResponseState } from "./actions";

export function EventApprovalActions({ eventId, canAccept, hasIssue, venueVersion }: { eventId: string; canAccept: boolean; hasIssue: boolean; venueVersion?: string }) {
  const [issueOpen, setIssueOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [state, action, pending] = useActionState<TrainerResponseState, FormData>(async (previous, form) => {
    const result = await respondToEventRoles(eventId, previous, form);
    if (result.success) setIssueOpen(false);
    return result;
  }, {});
  const confirmLabel = hasIssue ? "Problem behoben – erneut bestätigen" : "Bestätigen";
  return <form action={action} className={issueOpen ? "min-w-56 space-y-3" : "shrink-0 space-y-2"}>
    <input type="hidden" name="venueVersion" value={venueVersion ?? ""} />
    {issueOpen && <div id={`issue-form-${eventId}`}>
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor={`issue-${eventId}`} className="block text-sm">Beschreibe das Problem</label>
      <textarea key={requestId} id={`issue-${eventId}`} name="body" required maxLength={20000} disabled={pending} rows={4} className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700" />
    </div>}
    <div className={issueOpen ? "flex flex-wrap gap-2" : "inline-flex flex-nowrap items-center gap-2"}>
      {!issueOpen ? <>
        {canAccept && <button name="response" value="ACCEPTED" disabled={pending} title={confirmLabel} aria-label={confirmLabel} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-green-700 hover:bg-green-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-950">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
        </button>}
        <button type="button" disabled={pending} onClick={() => { setRequestId(crypto.randomUUID()); setIssueOpen(true); }} title="Problem melden" aria-label="Problem melden" aria-expanded={issueOpen} aria-controls={`issue-form-${eventId}`} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-orange-700 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-950">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></svg>
        </button>
      </> : <>
        <button name="response" value="ISSUE" disabled={pending} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Problem absenden</button>
        <button type="button" disabled={pending} onClick={() => setIssueOpen(false)} className="text-sm underline">Abbrechen</button>
      </>}
    </div>
    {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "sr-only" : "max-w-64 text-sm text-red-700 dark:text-red-300"}>{state.message}</p>}
  </form>;
}
