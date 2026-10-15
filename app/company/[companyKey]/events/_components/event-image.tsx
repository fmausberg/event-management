"use client";

import { useEffect, useRef, useState } from "react";

export function EventImage({ imageUrl, seriesImageUrl, onFileChange }: { imageUrl?: string | null; seriesImageUrl?: string | null; onFileChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  function clearSelection() {
    if (input.current) input.current.value = "";
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    onFileChange(null);
    setPreview(null);
    setError("");
  }
  const source = preview ?? (removed ? null : imageUrl ?? seriesImageUrl);
  return <div className="space-y-2">
    <label htmlFor="event-cover-image" className="block font-medium">Titelbild (16:9)</label>
    <div className="aspect-video overflow-hidden rounded-lg bg-zinc-100">
      {source && source !== failedSource ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="Vorschau des Titelbilds" onError={() => setFailedSource(source)} className="h-full w-full object-cover object-center" />
      ) : <div role="img" aria-label="Standardbild der Veranstaltung" className="flex h-full items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-amber-50">
        <svg aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-600/50"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3" /></svg>
      </div>}
    </div>
    <button type="button" onClick={() => input.current?.click()} aria-describedby="event-cover-help" className="rounded-lg bg-primary-100 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-200 disabled:opacity-50">Neues Bild</button>
    <input ref={input} id="event-cover-image" name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
      const file = event.target.files?.[0];
      if (!file) { clearSelection(); return; }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        clearSelection(); setError("Bitte ein JPEG-, PNG- oder WebP-Bild mit maximal 8 MB auswählen."); return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(file);
      onFileChange(file);
      setPreview(objectUrl.current); setRemoved(false); setError("");
    }} />
    <input type="hidden" name="removeImage" value={removed ? "yes" : "no"} />
    <p id="event-cover-help" className="text-xs text-zinc-500">JPEG, PNG oder WebP, maximal 8 MB. Das Bild wird mittig auf 16:9 zugeschnitten (1600 × 900 Pixel). Änderungen werden erst beim Speichern übernommen.</p>
    {!preview && !removed && !imageUrl && seriesImageUrl && <p className="text-xs text-zinc-500">Das Bild der Veranstaltungsreihe wird beim Erstellen in das Event übernommen.</p>}
    <div className="flex flex-wrap gap-3 text-sm">
      {preview && <button type="button" className="underline" onClick={clearSelection}>Auswahl verwerfen</button>}
      {(imageUrl || seriesImageUrl) && !removed && <button type="button" className="text-red-700 underline dark:text-red-300" onClick={() => { clearSelection(); setRemoved(true); }}>Titelbild entfernen</button>}
      {removed && <button type="button" className="underline" onClick={() => setRemoved(false)}>Entfernen rückgängig machen</button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </div>;
}
