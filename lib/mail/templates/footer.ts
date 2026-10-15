/** Added centrally by sendMail, including for messages redirected in test mode. */
export function mailFooter(recipient: string, imprintUrl: string) {
  const text = `Diese E-Mail ist für ${recipient} bestimmt.\nEventverwaltung GBR (Impressum: ${imprintUrl})`;
  const html = `
    <div style="max-width:600px;margin:24px auto 0;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#71717a">
      <p style="margin:0">Diese E-Mail ist für ${escapeHtml(recipient)} bestimmt.</p>
      <p style="margin:4px 0 0">
        Eventverwaltung GBR
        (<a href="${escapeHtml(imprintUrl)}" style="color:#71717a">Impressum</a>)
      </p>
    </div>
  `;
  return { text, html };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
