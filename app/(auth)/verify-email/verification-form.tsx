"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { loadVerificationEmail, resendVerification, verifyEmail } from "./actions";

export function VerificationForm() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [result, verify, pending] = useActionState<{ success?: boolean; message?: string }, FormData>(verifyEmail, {});
  const [sent, resend, sending] = useActionState<{ message?: string }, FormData>(resendVerification, {});
  useEffect(() => {
    const value = window.location.hash.slice(1);
    // Preserve the first read when Strict Mode replays this effect after URL cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken((current) => current ?? value);
    if (value) {
      // The secret fragment is browser-only: read after hydration, then remove it from the address bar.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    loadVerificationEmail(token).then((address) => {
      if (active) setEmail(address);
    }).catch(() => { /* Confirmation can still be retried if the lookup fails. */ });
    return () => { active = false; };
  }, [token]);
  const button = "rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50";
  return <div className="mt-6 space-y-6">
    {token && !result.success && <form action={verify} className="space-y-4">{email && <p className="break-words text-sm">E-Mail-Adresse: <strong>{email}</strong></p>}<input type="hidden" name="token" value={token} /><button disabled={pending} className={button}>{pending ? "Wird bestätigt …" : "E-Mail-Adresse bestätigen"}</button></form>}
    {result.message && <p role="status">{result.message}</p>}
    {token && result.message && !result.success && <Link href="/verify-email" className="block text-primary-700 underline dark:text-primary-300">Neuen Bestätigungslink anfordern</Link>}
    {token === "" && !result.success && <form action={resend} className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Nach der Registrierung erhältst du eine separate Bestätigungs-Mail. Erst mit bestätigter E-Mail-Adresse kannst du dich anmelden und deine Zuordnungen nutzen.</p>
      <label htmlFor="verification-email" className="block text-sm">Bestätigungs-Mail erneut anfordern</label>
      <input id="verification-email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="Deine E-Mail-Adresse" className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2" />
      <button disabled={sending} className={button}>{sending ? "Wird angefordert …" : "Link anfordern"}</button>
      {sent.message && <p role="status" className="text-sm">{sent.message}</p>}
    </form>}
    <Link href="/login" className="inline-block text-primary-700 underline dark:text-primary-300">Zur Anmeldung</Link>
  </div>;
}
