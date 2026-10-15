"use client";
import { AccountStatusTag } from "@/components/account-status-tag";

import { ResendAssignment } from "@/components/resend-assignment";
import { useEffect, useState, useTransition } from "react";
import { addEventStaff, listEventStaff, removeEventStaff } from "../staff-actions";
type Staff = { id: string; email: string; status: string };
export function EventStaff({ slug, eventId }: { slug: string; eventId: string }) {
 const [staff, setStaff] = useState<Staff[]>([]);
 const [email, setEmail] = useState("");
 const [message, setMessage] = useState("");
 const [loaded, setLoaded] = useState(false);
 const [pending, startTransition] = useTransition();
 useEffect(() => {
  let active = true;
  listEventStaff(slug, eventId).then((result) => {
   if (!active) return;
   if (result.staff) setStaff(result.staff); else setMessage(result.message ?? "Laden fehlgeschlagen.");
   setLoaded(true);
  }).catch(() => { if (active) { setMessage("Laden fehlgeschlagen. Bitte öffne das Event erneut."); setLoaded(true); } });
  return () => { active = false; };
 }, [slug, eventId]);
 function change(operation: () => Promise<{ success?: boolean; message?: string }>, added = false) {
  startTransition(async () => {
   try {
    const result = await operation();
    if (!result.success) { setMessage(result.message ?? "Speichern fehlgeschlagen."); return; }
    if (added) setEmail("");
    const next = await listEventStaff(slug, eventId);
    if (next.staff) { setStaff(next.staff); setMessage(result.message ?? (added ? "EventStaff hinzugefügt." : "Zuordnung entfernt.")); }
    else setMessage(next.message ?? "Laden fehlgeschlagen.");
   } catch { setMessage("Die Änderung konnte nicht abgeschlossen werden. Bitte lade das Event erneut."); }
  });
 }
 return <section className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
  <h3 className="font-semibold">EventStaff</h3>
  <form className="my-4 space-y-3" onSubmit={(event) => { event.preventDefault(); change(() => addEventStaff(slug, eventId, email), true); }}>
   <label className="block text-sm" htmlFor="event-staff-email">E-Mail-Adresse</label>
   <input id="event-staff-email" type="email" required maxLength={254} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2" />
   <button disabled={pending} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">Hinzufügen</button>
  </form>
  {message && <p role="status" className="mb-3 text-sm">{message}</p>}
  {!loaded ? <p>Wird geladen …</p> : <table className="w-full text-left text-xs"><caption className="sr-only">EventStaff und Kontostatus</caption><thead><tr><th className="py-2">E-Mail</th><th>Status</th><th scope="col" className="text-right">Aktionen</th></tr></thead><tbody>
   {staff.map((row) => <tr key={row.id} className="border-t border-zinc-200"><td className="break-all py-3 pr-2">{row.email}</td><td><AccountStatusTag status={row.status} /></td><td><div className="flex items-start justify-end gap-2">{row.status !== "verified" && <ResendAssignment kind="event" slug={slug} id={row.id} iconOnly />}<button type="button" disabled={pending} aria-label={`${row.email} entfernen`} title="Zuordnung entfernen" onClick={() => change(() => removeEventStaff(slug, eventId, row.id))} className="rounded-lg p-2 text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg></button></div></td></tr>)}
   {!staff.length && <tr><td colSpan={3} className="py-4 text-zinc-500">Noch kein EventStaff vorhanden.</td></tr>}
  </tbody></table>}
 </section>;
}
