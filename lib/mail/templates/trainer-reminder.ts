import { escapeHtml } from "./footer";

export type TrainerReminderMessage = {
  trainerName: string;
  eventName: string;
  beginsAt: Date;
  venue: string | null;
  confirmedSeats: number;
  participantsUrl: string;
};

const date = new Intl.DateTimeFormat("de-DE", {
  weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
});

/** Current event facts only; participant identities and ticket credentials stay behind authorization. */
export function trainerReminderMessage(data: TrainerReminderMessage) {
  const beginsAt = `${date.format(data.beginsAt)} Uhr (Berlin)`;
  const subject = `Event-Erinnerung: ${data.eventName}`;
  const text = [
    `Hallo ${data.trainerName},`,
    `dein Event „${data.eventName}“ beginnt in weniger als einer Stunde.`,
    `Beginn: ${beginsAt}`,
    data.venue ? `Ort: ${data.venue}` : "Ort: noch nicht festgelegt",
    `Aktuell bestätigte Plätze: ${data.confirmedSeats}`,
    `Die aktuelle Ticket- und Teilnehmerübersicht findest du nach Anmeldung hier:\n${data.participantsUrl}`,
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto">
      <h1 style="color:#007c80">Event beginnt bald</h1>
      <p>Hallo ${escapeHtml(data.trainerName)},</p>
      <p>dein Event <strong>„${escapeHtml(data.eventName)}“</strong> beginnt in weniger als einer Stunde.</p>
      <p>
        <strong>Beginn:</strong> ${escapeHtml(beginsAt)}<br>
        <strong>Ort:</strong> ${escapeHtml(data.venue ?? "noch nicht festgelegt")}<br>
        <strong>Aktuell bestätigte Plätze:</strong> ${data.confirmedSeats}
      </p>
      <p>Personenbezogene Teilnehmerdaten und Ticketinformationen bleiben in der geschützten Übersicht.</p>
      <p>
        <a href="${escapeHtml(data.participantsUrl)}"
           style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">
          Ticket- und Teilnehmerübersicht öffnen
        </a>
      </p>
      <p style="font-size:12px;color:#71717a;overflow-wrap:anywhere">
        Wenn der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>
        ${escapeHtml(data.participantsUrl)}
      </p>
    </div>
  `;
  return { subject, text, html };
}
