import { escapeHtml } from "./footer";



export type EventFacts = { name: string; beginsAt: Date | null; endsAt: Date | null; venue: string; company: string };

const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Berlin" });

export function approvalMessage(subject: string, paragraphs: string[], url: string) {

  return { subject, text: paragraphs.join("\n\n"), html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto"><h1 style="color:#007c80">${escapeHtml(subject)}</h1>${paragraphs.map(text => `<p style="white-space:pre-wrap">${escapeHtml(text)}</p>`).join("")}<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">Veranstaltung verwalten</a></p></div>` };

}

/** Trainer and venue requests share the same layout and compact event list. */
function availabilityMessage(events: EventFacts[], trainerName: string, url: string, venueRequest = false) {
  if (!events.length) throw new Error("An availability request requires at least one event");
  const company = events[0].company;
  const subject = venueRequest ? `${company}: Bitte bestätigt die Verfügbarkeit eurer Location` : `${company}: Bitte bestätige deine Verfügbarkeit`;
  const greeting = venueRequest ? "Hallo liebes Ortsteam," : `Hallo ${trainerName},`;
  const introduction = venueRequest ? "wir hoffen, dass es euch gut geht und freuen uns, unsere zukünftigen Veranstaltungen mit euch zu planen." : "wir hoffen, dass es dir gut geht und freuen uns, unsere zukünftigen Veranstaltungen mit dir zu planen.";
  const request = venueRequest ? "Wir bitten euch freundlich, die Verfügbarkeit eurer Location an den folgenden Terminen über den Button unten in dieser Mail zu bestätigen oder einen alternativen Terminvorschlag zu machen:" : "Wir bitten dich freundlich, deine Verfügbarkeit an den folgenden Terminen über den Button unten in dieser Mail zu bestätigen oder einen alternativen Terminvorschlag zu machen:";
  const appointments = events.map(event => `${event.name}: ${event.beginsAt ? date.format(event.beginsAt) + " Uhr" : "Beginn noch offen"} @ ${event.venue}`);
  const signature = `${venueRequest ? "Euer" : "Dein"} ${company}-Team`;
  return {
    subject,
    text: [greeting, introduction, request, appointments.map(appointment => `- ${appointment}`).join("\n"), `Verfügbarkeit angeben:\n${url}`, "Liebe Grüße", signature].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto">
      <p>${escapeHtml(greeting)}</p><p>${escapeHtml(introduction)}</p><p>${escapeHtml(request)}</p>
      <ul>${appointments.map(appointment => `<li>${escapeHtml(appointment)}</li>`).join("")}</ul>
      <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">Verfügbarkeit angeben</a></p>
      <p>Liebe Grüße</p><p>${escapeHtml(signature)}</p>
    </div>`,
  };
}

export function trainerConfirmationMessage(event: EventFacts, trainerName: string, url: string) {
  return availabilityMessage([event], trainerName, url);
}

function issueMessage(event: EventFacts, body: string, url: string, name: string | null, email: string) {
  const message = approvalMessage(`Trainer- oder Location-Absage: ${event.name}`, [
    "Für dieses Event besteht Handlungsbedarf. Bitte entscheide, wie du weiter verfahren möchtest.",
    [event.name, event.beginsAt ? date.format(event.beginsAt) + " Uhr" : "Beginn noch offen", event.venue].join("\n"),
    "Eine Absage des genannten Termins wurde gemeldet und die entsprechende Person um Angabe eines Alternativvorschlags gebeten. Im Folgenden findest du die Antwort:",
    [name?.trim() ? `Name: ${name.trim()}` : null, `E-Mail: ${email}`].filter(Boolean).join("\n"),
    body,
  ], url);
  return { ...message, text: `${message.text}\n\nVeranstaltung verwalten:\n${url}` };
}

export function trainerIssueMessage(event: EventFacts, trainerName: string | null, body: string, url: string, email: string) {
  return issueMessage(event, body, url, trainerName, email);
}

export function trainerBatchConfirmationMessage(events: EventFacts[], trainerName: string, url: string) {
  return availabilityMessage(events, trainerName, url);
}

export function venueConfirmationMessage(events: EventFacts[], url: string) {
  return availabilityMessage(events, "", url, true);
}
export function venueIssueMessage(event: EventFacts, memberName: string | null, body: string, url: string, email: string) {
  return issueMessage(event, body, url, memberName, email);
}

export function eventApprovalIssueMessage(event: EventFacts, memberName: string | null, _role: string, body: string, url: string, email: string) {
  return issueMessage(event, body, url, memberName, email);
}
