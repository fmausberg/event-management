export type BookingConfirmation = {
  customerName: string;
  bookingNumber: number;
  eventName: string;
  beginsAt: Date | null;
  quantity: number;
  ticketLinks?: string[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Edit the subject and text here; HTML is generated from the same content. */
export function bookingConfirmation(data: BookingConfirmation) {
  const date = data.beginsAt ? new Intl.DateTimeFormat("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  }).format(data.beginsAt) : "Termin noch offen";
  const subject = `Deine Buchungsbestätigung #${data.bookingNumber}`;
  const text = `Hallo ${data.customerName},

vielen Dank für deine Buchung! Deine Plätze sind bestätigt.

Buchungsnummer: ${data.bookingNumber}
Event: ${data.eventName}
Beginn: ${date} Uhr (Europe/Berlin)
Anzahl Plätze: ${data.quantity}

Bitte bewahre diese Buchungsbestätigung auf.
Wir freuen uns auf dich!

Dein Event-Management-Team`;
  const links = data.ticketLinks ?? [];
  const ticketText = links.length ? "\n\nDeine Tickets (ein Link pro Platz):\n" + links.map((url, index) => `Ticket ${index + 1}: ${url}`).join("\n") + "\nBitte behandle diese Links vertraulich." : "";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto"><h1 style="color:#007c80">Buchungsbestätigung</h1>${text.split("\n\n").map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
  const ticketHtml = links.length ? `<h2>Deine Tickets</h2>${links.map((url, index) => `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">Ticket ${index + 1} öffnen</a></p>`).join("")}<p>Bitte behandle diese Links vertraulich.</p>` : "";
  return { subject, text: text + ticketText, html: html.replace("</div>", ticketHtml + "</div>") };
}
