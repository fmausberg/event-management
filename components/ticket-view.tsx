"use client";
import { useEffect, useState } from "react";
import { TicketCard } from "@/components/ticket-card";
import type { TicketViewModel } from "@/lib/tickets/view-model";
export function TicketView() {
  const [ticket, setTicket] = useState<TicketViewModel | null>(null);
  const [ticketToken, setTicketToken] = useState("");
  const [message, setMessage] = useState("Ticket wird geladen …");
  useEffect(() => {
    const controller = new AbortController();
    const token = window.location.hash.slice(1);
    async function load() {
      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setMessage("Ticket nicht verfügbar."); return; }
        const response = await fetch("/api/public-ticket", { method: "POST", body: token, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) { setMessage(data.message); return; }
        setTicketToken(token);
        setTicket(data);
      } catch { if (!controller.signal.aborted) setMessage("Ticket aktuell nicht verfügbar. Bitte lade die Seite erneut."); }
    }
    void load();
    return () => controller.abort();
  }, []);
  return <main className="mx-auto w-full max-w-xl px-5 py-10">
    {ticket ? <><TicketCard ticket={ticket} qrCode={{ value: ticketToken }} />
      <details className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <summary className="cursor-pointer font-medium text-primary-700 dark:text-primary-300">Informationen zur Stornierung</summary>
        <p className="mt-3 text-sm">Nutze den Link „Buchung verwalten / stornieren“ in der ursprünglichen Buchungsbestätigung. Dort kann die buchende Person ohne Anmeldung die gesamte Buchung mit allen zugehörigen Tickets gemäß den Stornierungsbedingungen stornieren oder eine Anfrage senden.</p>
        <p className="mt-2 text-sm">Wenn dir dieses Ticket weitergeleitet wurde, wende dich bitte an die Person, die die Buchung vorgenommen hat. Fehlt der Verwaltungslink in deiner Bestätigung, bitte den Veranstalter, die Ticket-E-Mail erneut zu senden.</p>
      </details></> : <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-2xl font-semibold">Dein Ticket</h1>
      <p role="status" className="mt-4">{message}</p>
    </section>}
  </main>;
}
