import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";
export function descriptionToText(html: string | null | undefined): string {
  return convert(html ?? "", { wordwrap: false }).replace(/\u00a0/g, " ").trim();
}
export function isDescriptionEmpty(html: string | null | undefined): boolean {
  return !descriptionToText(sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {}, nonTextTags: ["script", "style", "textarea", "option", "iframe", "object"] }));
}
export function sanitizeDescription(html: string | null | undefined): string | null {
  if (html == null) return null;
  const clean = sanitizeHtml(html, { allowedTags: ["p", "br", "strong", "em", "u", "ul", "ol", "li", "a"], allowedAttributes: { a: ["href", "title"] }, allowedSchemes: ["http", "https", "mailto", "tel"], allowProtocolRelative: false, nonTextTags: ["script", "style", "textarea", "option", "iframe", "object"], transformTags: { b: "strong", i: "em" } });
  return isDescriptionEmpty(clean) ? null : clean;
}
// Explicit plaintext conversion only; never use for inherited HTML.
export function plainTextToDescription(value: string | null): string | null {
  if (value === null || value === "") return value;
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?/g, "\n");
  return "<p>" + escaped.replace(/\n[ \t]*\n/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
}
