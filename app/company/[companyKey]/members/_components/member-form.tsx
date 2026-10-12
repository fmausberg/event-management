"use client";

import { useActionState } from "react";
import { addCompanyMember, type MemberFormState } from "../actions";

export function MemberForm({ companySlug }: { companySlug: string }) {
  const [state, action, pending] = useActionState<MemberFormState, FormData>(addCompanyMember.bind(null, companySlug), {});
  return <form action={action} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 className="font-semibold">Mitglied hinzufügen</h2>
    <label htmlFor="member-email" className="block text-sm">E-Mail-Adresse</label>
    <div className="flex flex-wrap gap-3">
      <input id="member-email" name="email" type="email" required maxLength={254} autoComplete="email" disabled={pending} placeholder="name@beispiel.de" className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700" />
      <button disabled={pending} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">{pending ? "Wird hinzugefügt …" : "Hinzufügen"}</button>
    </div>
    <p className="text-xs text-zinc-500">Auch ohne vorhandenen Account möglich. Es wird keine E-Mail versendet.</p>
    {state.message && <p role={state.success ? "status" : "alert"} className={state.success ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-red-700 dark:text-red-400"}>{state.message}</p>}
  </form>;
}
