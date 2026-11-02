export type BookingConfirmation = {
  customerName: string;
  bookingNumber: number;
  eventName: string;
  beginsAt: Date | null;
  quantity: number;
  ticketLinks?: string[];
  managementLink?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Subject, plain text and HTML body. The sender adds the shared footer. */
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
  const managementText = data.managementLink ? `\n\nBuchung verwalten / stornieren:\n${data.managementLink}\nDieser Link funktioniert ohne Anmeldung und gilt für die gesamte Buchung mit allen Tickets. Gib beim Weiterleiten einzelner Tickets nur den jeweiligen Ticketlink weiter, nicht diesen Verwaltungslink.` : "";
  // HTML layout: greeting, booking details, closing, individual ticket buttons.
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto">
      <h1 style="color:#007c80">Buchungsbestätigung</h1>
      <p>Hallo ${escapeHtml(data.customerName)},</p>
      <p>vielen Dank für deine Buchung! Deine Plätze sind bestätigt.</p>

      <p>
        Buchungsnummer: ${data.bookingNumber}<br>
        Event: ${escapeHtml(data.eventName)}<br>
        Beginn: ${escapeHtml(date)} Uhr (Europe/Berlin)<br>
        Anzahl Plätze: ${data.quantity}
      </p>

      <p>
        Bitte bewahre diese Buchungsbestätigung auf.<br>
        Wir freuen uns auf dich!
      </p>
      <p>Dein Event-Management-Team</p>

      ${links.length ? `
        <h2>Deine Tickets</h2>
        ${links.map((url, index) => `
          <p>
            <a href="${escapeHtml(url)}"
               style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">
              Ticket ${index + 1} öffnen
            </a>
          </p>
          <p style="font-size:12px;color:#71717a;overflow-wrap:anywhere">
            Wenn der Button nicht funktioniert, kopiere den folgenden Link und füge ihn in deinem Browser ein:<br>
            ${escapeHtml(url)}
          </p>
        `).join("")}
        <p>Bitte behandle diese Links vertraulich.</p>
      ` : ""}
      ${data.managementLink ? `
        <h2>Buchung verwalten / stornieren</h2>
        <p><a href="${escapeHtml(data.managementLink)}">Buchung verwalten / stornieren</a></p>
        <p>Hier kannst du ohne Anmeldung die gesamte Buchung mit allen Tickets gemäß den Stornierungsbedingungen stornieren oder eine Stornierung anfragen.</p>
        <p>Gib beim Weiterleiten einzelner Tickets nur den jeweiligen Ticketlink weiter, nicht diesen Verwaltungslink.</p>
      ` : ""}
    </div>
  `;
  return { subject, text: text + ticketText + managementText, html };
}
