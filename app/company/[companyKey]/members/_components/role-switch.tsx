"use client";

import { useActionState } from "react";
import type { CompanyRole } from "@prisma/client";
import { changeMemberRole, type MemberFormState } from "../actions";

export function RoleSwitch({ companySlug, membershipId, email, role }: { companySlug: string; membershipId: string; email: string; role: CompanyRole }) {
  const [state, action, pending] = useActionState<MemberFormState, FormData>(changeMemberRole.bind(null, companySlug, membershipId), {});
  const isAdmin = role === "COMPANY_ADMIN";
  return <form action={action} className="min-w-36">
    <input type="hidden" name="role" value={isAdmin ? "COMPANY_USER" : "COMPANY_ADMIN"} />
    <div className="flex items-center gap-2">
      <span className="text-xs">User</span>
      <button type="submit" role="switch" aria-checked={isAdmin} aria-label={`Company-Admin für ${email}`} disabled={pending} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-wait disabled:opacity-50 ${isAdmin ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${isAdmin ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      <span className="text-xs">Admin</span>
    </div>
    {pending ? <p role="status" className="mt-2 text-xs text-zinc-500">Wird gespeichert …</p> : state.message && <p role={state.success ? "status" : "alert"} className={`mt-2 max-w-64 text-xs ${state.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>{state.message}</p>}
  </form>;
}
