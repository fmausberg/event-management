"use client";

import { useActionState, useState } from "react";
import { respondToEventRoles, type TrainerResponseState } from "./actions";

export function EventApprovalActions({ eventId, canAccept, canDecline = canAccept, hasIssue, venueVersion }: { eventId: string; canAccept: boolean; canDecline?: boolean; hasIssue: boolean; venueVersion?: string }) {
  const [issueOpen, setIssueOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [state, action, pending] = useActionState<TrainerResponseState, FormData>(async (previous, form) => {
    const result = await respondToEventRoles(eventId, previous, form);
    if (result.success) setIssueOpen(false);
    return result;
  }, {});
  const awaitingResponse = canDecline && !hasIssue;
  return <form action={action} className={issueOpen ? "min-w-56 space-y-3" : "shrink-0 space-y-2"}>
    <input type="hidden" name="venueVersion" value={venueVersion ?? ""} />
    {issueOpen && <div id={`issue-form-${eventId}`}>
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor={`issue-${eventId}`} className="block text-sm">{awaitingResponse ? "Hast du andere Terminvorschläge?" : "Beschreibe das Problem"}</label>
      <textarea key={requestId} id={`issue-${eventId}`} name="body" required maxLength={20000} disabled={pending} rows={4} className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700" />
    </div>}
    <div className={issueOpen ? "flex flex-wrap gap-2" : "inline-flex flex-nowrap items-center gap-2"}>
      {!issueOpen ? <>
        {canAccept && !hasIssue && <button name="response" value="ACCEPTED" disabled={pending} className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-green-700 px-2.5 py-1 text-sm font-medium leading-tight text-white hover:bg-green-800 disabled:opacity-50">
          Annehmen
        </button>}
        <button type="button" disabled={pending} onClick={() => { setRequestId(crypto.randomUUID()); setIssueOpen(true); }} aria-expanded={issueOpen} aria-controls={`issue-form-${eventId}`} className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium leading-tight disabled:opacity-50 ${awaitingResponse ? "bg-red-700 text-white hover:bg-red-800" : "bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900"}`}>
          {awaitingResponse ? "Ablehnen" : "Problem melden"}
        </button>
      </> : <>
        <button name="response" value="ISSUE" disabled={pending} className="rounded-lg bg-primary-600 px-2.5 py-1 text-sm font-medium leading-tight text-white disabled:opacity-50">{awaitingResponse ? "Ablehnung absenden" : "Problem absenden"}</button>
        <button type="button" disabled={pending} onClick={() => setIssueOpen(false)} className="text-sm underline">Abbrechen</button>
      </>}
    </div>
    {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "sr-only" : "max-w-64 text-sm text-red-700 dark:text-red-300"}>{state.message}</p>}
  </form>;
}
