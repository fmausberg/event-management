import { escapeHtml } from "./footer";



type EventFacts = { name: string; beginsAt: Date | null; endsAt: Date | null; venue: string; company: string };

const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Berlin" });

function facts(event: EventFacts) {

  return [`Event: ${event.name}`, `Beginn: ${event.beginsAt ? date.format(event.beginsAt) + " Uhr" : "Noch offen"}`,

    `Ende: ${event.endsAt ? date.format(event.endsAt) + " Uhr" : "Noch offen"}`, `Ort: ${event.venue}`, `Company: ${event.company}`];

}

function message(subject: string, paragraphs: string[], url: string) {

  return { subject, text: paragraphs.join("\n\n"), html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto"><h1 style="color:#007c80">${escapeHtml(subject)}</h1>${paragraphs.map(text => `<p style="white-space:pre-wrap">${escapeHtml(text)}</p>`).join("")}<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">Veranstaltung verwalten</a></p></div>` };

}

export function trainerConfirmationMessage(event: EventFacts, trainerName: string, url: string) {

  return message(`Bitte bestätige dein Event: ${event.name}`, [

    `Hallo ${trainerName},`, "bitte sage für dieses Event zu oder melde ein Issue mit einer kurzen Begründung. Das Event wird erst veröffentlicht, wenn alle zugeordneten Trainer zugesagt haben.",

    ...facts(event), `Öffne nach der Anmeldung deine Veranstaltungsübersicht und wähle „Zusagen“ oder „Issue melden“:\n${url}`,

  ], url);

}

export function trainerIssueMessage(event: EventFacts, trainerName: string, body: string, url: string) {

  return message(`Trainer-Issue: ${event.name}`, ["Für dieses Event wurde ein Issue gemeldet. Bitte entscheidet, wie ihr mit dem Event weiterverfahren möchtet.", ...facts(event), `Trainer: ${trainerName}`, body, `Event verwalten:\n${url}`], url);

}


export function trainerBatchConfirmationMessage(events: EventFacts[], trainerName: string, url: string) {
  return message(`Bitte bestätige deine Events (${events.length})`, [
    `Hallo ${trainerName},`,
    `dir wurden ${events.length} gemeinsam erstellte Events zugeordnet. Bitte prüfe jeden Termin und sage zu oder melde ein Problem. Die Freigabe erfolgt für jedes Event einzeln.`,
    ...events.map(event => facts(event).join("\n")),
    `Hier kannst du die Termine nach der Anmeldung einzeln bestätigen oder ein Problem melden:\n${url}`,
  ], url);
}
