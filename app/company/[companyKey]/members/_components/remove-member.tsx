"use client";

import { useActionState, useState } from "react";
import { removeCompanyMember, type MemberFormState } from "../actions";

export function RemoveMember({ companySlug, membershipId, email }: { companySlug: string; membershipId: string; email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<MemberFormState, FormData>(removeCompanyMember.bind(null, companySlug, membershipId), {});
  return <div className="flex flex-col items-end gap-2">
    {confirming ? <form action={action} className="max-w-64 space-y-2 text-sm">
      <p>Mitgliedschaft von {email} entfernen?</p>
      <input type="hidden" name="confirmed" value="yes" />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="text-red-700 underline disabled:opacity-50 dark:text-red-300">{pending ? "Wird entfernt …" : "Entfernen"}</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="underline disabled:opacity-50">Abbrechen</button>
      </div>
    </form> : <button type="button" onClick={() => setConfirming(true)} aria-label={`Mitgliedschaft von ${email} entfernen`} title="Mitgliedschaft entfernen" className="rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:hover:bg-red-950 dark:hover:text-red-300">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></svg>
    </button>}
    {state.message && <p role={state.success ? "status" : "alert"} className="max-w-64 text-xs text-red-700 dark:text-red-300">{state.message}</p>}
  </div>;
}
