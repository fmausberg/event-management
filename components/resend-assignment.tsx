"use client";
import { useState, useTransition } from "react";
import { resendAssignment } from "@/app/company/assignment-actions";
import type { AssignmentKind } from "@/lib/mail/assignment";
export function ResendAssignment({ kind, slug, id, iconOnly = false }: { kind: AssignmentKind; slug: string; id: string; iconOnly?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const label = pending ? "Wird gesendet …" : "Benachrichtigung erneut senden";
  return <div><button type="button" disabled={pending} title={iconOnly ? label : undefined} aria-label={iconOnly ? label : undefined} onClick={() => start(async () => {
    try { setMessage((await resendAssignment(kind, slug, id)).message); }
    catch { setMessage("Die Benachrichtigung konnte nicht gesendet werden."); }
  })} className={iconOnly ? "rounded-lg p-2 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-950" : "text-xs text-primary-700 underline disabled:opacity-50 dark:text-primary-300"}>{iconOnly ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg> : label}</button>{message && <p role="status" className="mt-1 max-w-xs text-xs">{message}</p>}</div>;
}
