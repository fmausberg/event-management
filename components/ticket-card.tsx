import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import Image from "next/image";
import eventYogaLogo from "@/public/Event-Yoga-Logo-V2.webp";
import type { TicketViewModel } from "@/lib/tickets/view-model";

type TicketCardProps = {
  ticket: TicketViewModel;
  bookingNumber?: number;
  // The caller supplies its existing credential. This component never creates one.
  qrCode: { value: string } | null;
  children?: ReactNode;
};

export function TicketCard({ ticket, bookingNumber, qrCode, children }: TicketCardProps) {
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const checkedInDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
  const ticketNumber = new Intl.NumberFormat("de-DE", { useGrouping: true }).format(ticket.number);
  return <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold">Dein Ticket</h1>
        <p className="text-sm text-zinc-500">Ticket #{ticketNumber}{bookingNumber != null && ` · Buchung #${bookingNumber}`}</p>
        {ticket.bookedByName && <p className="break-words text-sm"><span className="text-zinc-500">Gebucht von:</span> {ticket.bookedByName}</p>}
      </div>
      <Image src={eventYogaLogo} width={1626} height={1626} alt="Event Yoga" className="h-auto w-20 shrink-0 sm:w-24" />
    </div>
    <h2 className="break-words text-xl font-semibold">{ticket.eventName}</h2>
    <p>{ticket.beginsAt ? `${date.format(new Date(ticket.beginsAt))} Uhr (Berlin)` : "Termin noch offen"}</p>
    {ticket.venue && <p className="break-words">{ticket.venue}</p>}
    <p><span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${ticket.status === "Gültig" ? "bg-green-100 text-green-800" : ticket.status === "Storniert" || ticket.status === "Nicht gültig" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}>{ticket.status}</span></p>
    {ticket.checkedInAt && <p className="text-sm">Bereits eingelöst am {checkedInDate.format(new Date(ticket.checkedInAt))} Uhr (Berlin)</p>}
    {qrCode && ticket.status === "Gültig" && <figure className="flex flex-col items-center gap-4 rounded-lg bg-white p-4 text-zinc-900">
      <QRCodeSVG value={qrCode.value} size={260} level="M" marginSize={4} title={`QR-Code für Ticket #${ticketNumber}`} className="h-auto max-w-full" />
      <figcaption className="text-center text-sm">Dein Ticket-QR-Code
        <span className="block">Zeige diesen QR-Code beim Einlass vor.</span>
      </figcaption>
    </figure>}
    {children}
  </section>;
}
