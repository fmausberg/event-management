import { escapeHtml } from "./footer";

/** Subject, plain text and HTML body. The sender adds the shared footer. */
export function emailVerification(link: string) {
  const subject = "Bestätige deine E-Mail-Adresse";
  const text = `Bitte bestätige deine E-Mail-Adresse für die Eventverwaltung:

${link}

Der Link ist 24 Stunden gültig. Erst nach der Bestätigung werden deine hinterlegten Rollen zugeordnet. Falls du kein Konto erstellt hast, ignoriere diese Nachricht.`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:600px;margin:auto">
      <h1 style="color:#007c80">E-Mail-Adresse bestätigen</h1>
      <p>Bitte bestätige deine E-Mail-Adresse für die Eventverwaltungs-Plattform.</p>

      <p>
        <a href="${escapeHtml(link)}"
           style="display:inline-block;background:#ff8500;color:#18181b;padding:12px 20px;border-radius:6px;text-decoration:none">
          E-Mail-Adresse bestätigen
        </a>
      </p>
      <p style="font-size:12px;color:#71717a;overflow-wrap:anywhere">
        Wenn der Button nicht funktioniert, kopiere den folgenden Link und füge ihn in deinem Browser ein:<br>
        ${escapeHtml(link)}
      </p>

      <p>
        Der Link ist 24 Stunden gültig.
        Erst nach der Bestätigung werden deine hinterlegten Rollen zugeordnet.
      </p>
      <p>Falls du kein Konto erstellt hast, ignoriere diese Nachricht.</p>
    </div>
  `;
  return { subject, text, html };
}
