"use client";
import { useActionState } from "react";
import { redeemCompanyTicket } from "./actions";
export function RedeemButton({ slug, eventId, ticketId }: { slug: string; eventId: string; ticketId: string }) {
 const [state, action, pending] = useActionState(redeemCompanyTicket.bind(null, slug, eventId, ticketId), {});
 return <form action={action}><button disabled={pending} className="rounded-lg bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-50">{pending ? "Wird eingelöst …" : "Einlösen"}</button>{state.message && <p role="status" className="mt-2 text-xs">{state.message}</p>}</form>;
}
