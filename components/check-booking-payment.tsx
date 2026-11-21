"use client";

import { useActionState } from "react";
import { checkBookingPayment } from "@/app/company/[companyKey]/bookings/payment-actions";

export function CheckBookingPayment({ companySlug, bookingId, pendingPayment }: { companySlug: string; bookingId: string; pendingPayment: boolean }) {
  const [state, action, pending] = useActionState<{ message: string; error?: boolean }, FormData>(async () => {
    try { return await checkBookingPayment(companySlug, bookingId); }
    catch { return { error: true, message: "Die Zahlung konnte gerade nicht geprüft werden. Bitte versuche es später erneut." }; }
  }, { message: "" });
  if (!pendingPayment && !state.message) return null;
  return <form action={action} className="max-w-64 space-y-2">
    {pendingPayment && <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{pending ? "Wird geprüft …" : "Zahlung prüfen"}</button>}
    {state.message && <p role={state.error ? "alert" : "status"} className={state.error ? "text-sm text-red-700 dark:text-red-300" : "text-sm text-zinc-600 dark:text-zinc-300"}>{state.message}</p>}
  </form>;
}
