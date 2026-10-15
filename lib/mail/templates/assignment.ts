export type AssignmentNotification = {
  actorName: string;
  companyName: string;
  role: string;
  scope?: string;
  registrationUrl: string;
  verificationUrl: string;
  accountStatus: "missing" | "unverified" | "verified";
  eventUrl?: string;
  myEventsUrl?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Subject, plain text and HTML body. The sender adds the shared footer. */
export function assignmentNotification(data: AssignmentNotification) {
  const subject = "Neue Zuordnung in der Eventverwaltung";
  const venueAssignment = data.role === "Venue-Staff" && !!data.scope;
  const introduction = venueAssignment
    ? `${data.actorName} von ${data.companyName} hat dich für ${data.scope} als Venue-Staff eingetragen.`
    : `${data.actorName} hat dich bei ${data.companyName} als ${data.role} eingetragen.`;
  const instruction = data.accountStatus === "missing"
    ? `Erstelle dein Konto mit dieser E-Mail-Adresse und bestätige anschließend deine Adresse über die separate Verifizierungs-Mail:\n${data.registrationUrl}`
    : data.accountStatus === "unverified"
      ? `Du hast bereits ein Konto? Melde dich an. Falls deine Adresse noch nicht bestätigt ist, fordere unter ${data.verificationUrl} einen Bestätigungslink an.`
      : "";
  const eventUrl = data.accountStatus === "verified" ? data.eventUrl : undefined;
  const scopeText = data.scope && !venueAssignment ? `Zuordnung: ${data.scope}${eventUrl ? `\n${eventUrl}` : ""}` : "";
  const eventsHint = "Unter „Meine Veranstaltungen“ findest du alle anstehenden Veranstaltungen, denen du als Venue-Staff zugeordnet bist.";
  const text = [introduction, scopeText, instruction, data.myEventsUrl ? `${eventsHint}\n${data.myEventsUrl}` : ""].filter(Boolean).join("\n\n");
  const buttonUrl = data.accountStatus === "missing" ? data.registrationUrl : data.accountStatus === "unverified" ? data.verificationUrl : undefined;
  const buttonLabel = data.accountStatus === "missing" ? "Konto erstellen" : "E-Mail bestätigen";
  const htmlInstruction = data.accountStatus === "missing"
    ? "Erstelle dein Konto mit dieser E-Mail-Adresse und bestätige anschließend deine Adresse über die separate Verifizierungs-Mail."
    : data.accountStatus === "unverified"
      ? "Dein Konto ist noch nicht verifiziert. Fordere über den folgenden Button einen Bestätigungslink an."
      : "";
  // HTML layout: heading, assignment, account instructions, action button.
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto">
      <h1 style="color:#007c80">Neue Zuordnung</h1>
      <p>${escapeHtml(introduction)}</p>

      ${data.scope && !venueAssignment ? `
        <p>
          Zuordnung:
          ${eventUrl
            ? `<a href="${escapeHtml(eventUrl)}">${escapeHtml(data.scope)}</a>`
            : escapeHtml(data.scope)}
        </p>
      ` : ""}

      ${htmlInstruction ? `
        <p>${escapeHtml(htmlInstruction)}</p>
      ` : ""}

      ${buttonUrl ? `
        <p>
          <a href="${escapeHtml(buttonUrl)}"
             style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">
            ${buttonLabel}
          </a>
        </p>
        <p style="font-size:12px;color:#71717a;overflow-wrap:anywhere">
          Wenn der Button nicht funktioniert, kopiere den folgenden Link und füge ihn in deinem Browser ein:<br>
          ${escapeHtml(buttonUrl)}
        </p>
      ` : ""}

      ${data.myEventsUrl ? `
        <p>${escapeHtml(eventsHint)}</p>
        <p>
          <a href="${escapeHtml(data.myEventsUrl)}"
             style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">
            Meine Veranstaltungen
          </a>
        </p>
        <p style="font-size:12px;color:#71717a;overflow-wrap:anywhere">
          Wenn der Button nicht funktioniert, kopiere den folgenden Link und füge ihn in deinem Browser ein:<br>
          ${escapeHtml(data.myEventsUrl)}
        </p>
      ` : ""}
    </div>
  `;
  return { subject, text, html };
}
