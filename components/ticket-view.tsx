"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
type Ticket = {
  number: number;
  status: string;
  checkedInAt: string | null;
  eventName: string;
  beginsAt: string;
  venue: string | null
};
export function TicketView() {
  const [ticket, setTicket] = useState<Ticket | null>(null);
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
  return <main className="mx-auto w-full max-w-xl px-5 py-12"><section className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
    <h1 className="text-2xl font-semibold">Dein Ticket</h1>
    {!ticket ? <p role="status" className="mt-4">{message}</p> : <>
      <p className="mt-4 text-sm text-zinc-500">Ticket #{ticket.number}</p>
      <h2 className="mt-2 text-xl font-semibold">{ticket.eventName}</h2>
      <p className="mt-3">{new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(ticket.beginsAt))} Uhr (Berlin)</p>
      {ticket.venue && <p className="mt-2">{ticket.venue}</p>}
      {ticketToken && <figure className="mt-6 flex flex-col items-center gap-2">
        <QRCodeSVG value={ticketToken} size={240} level="M" marginSize={4} title={`QR-Code für Ticket #${ticket.number}`} className="h-auto max-w-full" />
        <figcaption className="text-sm text-zinc-500">Dein Ticket-QR-Code</figcaption>
      </figure>}
      <p className="mt-6"><span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${ticket.status === "Gültig" ? "bg-green-100 text-green-800" : ticket.status === "Storniert" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{ticket.status === "Bereits eingelöst" && ticket.checkedInAt ? `eingelöst ${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(ticket.checkedInAt))} Uhr (Berlin)` : ticket.status}</span></p>
      <p className="mt-5 text-sm text-zinc-500">Zeige diesen QR-Code beim Einlass vor.</p>
    </>}
  </section></main>;
}
