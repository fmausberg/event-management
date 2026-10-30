import { escapeHtml } from "./footer";

export function eventReviewMessage(eventName: string, origin: string, token: string) {
  const links = [1, 2, 3, 4, 5].map(value => ({ value,
    // Like ticket links, the bearer secret stays out of HTTP logs and Referer.
    url: `${origin}/reviews#${new URLSearchParams({ token, rating: String(value) })}`,
  }));
  const greeting = "Hey, vielen Dank, dass du da warst! Wir hoffen, es hat dir gefallen und du hattest eine schöne Zeit bei uns.";
  const invitation = "Wir möchten uns immer weiterentwickeln – und dein Feedback hilft uns dabei. Wie hat dir das Event gefallen?";
  const callToAction = "Wir freuen uns über deine Bewertung! Klicke einfach auf die Sterne:";
  return {
    subject: "Wie hat dir das Event gefallen?",
    text: `Danke, dass du bei ${eventName} dabei warst!\n\n${greeting}\n\n${invitation}\n\n${callToAction}\n\n${links.map(({ value, url }) => `${value} Sterne: ${url}`).join("\n")}`,
    html: `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;line-height:1.6"><h1>Danke, dass du bei ${escapeHtml(eventName)} dabei warst!</h1><p>${greeting}</p><p>${invitation}</p><p>${callToAction}</p><p>${links.map(({ value, url }) => `<a href="${escapeHtml(url)}" aria-label="${value} Sterne" style="display:inline-block;padding:8px 4px;color:#ff8500;font-size:32px;text-decoration:none">★</a>`).join("")}</p></div>`,
  };
}
