"use client";

import { useRef, useState, useSyncExternalStore } from "react";

const subscribe = () => () => { };
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function EmbedCode({ slug, companyName }: { slug: string; companyName: string }) {
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const field = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const url = origin ? `${origin}/events/${encodeURIComponent(slug)}?embed=1` : "";
  const code = url ? `<iframe
  src="${escapeAttribute(url)}"
  title="${escapeAttribute(`Veranstaltungen von ${companyName}`)}"
  width="100%"
  height="900"
  style="border: 0; display: block;"
  loading="lazy"
></iframe>` : "";

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Einbettungscode kopiert.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setMessage("Bitte kopiere den markierten Code mit Strg+C bzw. ⌘C.");
    } finally { setCopying(false); }
  }

  return <section className="max-w-2xl space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
    <h2 className="text-xl font-semibold">Veranstaltungen auf deiner Website einbinden</h2>
    <p className="text-sm">Füge diesen HTML-Code auf deiner Website ein. Die Übersicht zeigt beim Laden die aktuellen veröffentlichten Veranstaltungen deiner Company. Eventdetails und Buchung öffnen sich in einem neuen Tab.</p>
    <div><label htmlFor="company-embed-code" className="text-sm font-medium">iframe-Code</label>
      <textarea ref={field} id="company-embed-code" readOnly rows={9} value={code} placeholder="Einbettungscode wird geladen …" spellCheck={false} onFocus={(event) => event.currentTarget.select()} className="mt-2 block w-full rounded-lg border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" />
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" disabled={!code || copying} onClick={() => void copy()} className="rounded-md bg-primary-700 px-4 py-2 text-white disabled:opacity-50">{copying ? "Wird kopiert …" : "Code kopieren"}</button>
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline">Vorschau öffnen</a>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    <p className="text-xs text-zinc-500">Die Höhe von 900 Pixeln kannst du im Code anpassen.</p>
  </section>;
}
