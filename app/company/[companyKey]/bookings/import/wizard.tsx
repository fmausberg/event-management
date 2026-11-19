"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fields, type Field, type Mapping, type Preview, type ImportConfig } from "@/lib/bookings/import/types";
import { inspectFile, previewImport, confirmImport } from "./actions";

const control = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950";
const button = "rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40";
const panel = "space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
const labels = { READY: "Importierbar", WARNING: "Warnung", ERROR: "Fehler", DUPLICATE: "Duplikat", EXCLUDED: "Ausgeschlossen" };
const bookingStatuses = { CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" };
const dateFormatter = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
const formatDate = (s: string | null) => s ? dateFormatter.format(new Date(s)) : "—";

export function ImportWizard({ slug, platforms }: { slug: string; platforms: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<{ name: string; headers: string[]; count: number; mapping: Mapping }[]>([]);
  const [config, setConfig] = useState<ImportConfig>({ requestId: "", sheet: "", platform: "RAUSGEGANGEN", name: "", mapping: {}, events: {}, excluded: [] });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dirty, setDirty] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [eventQueries, setEventQueries] = useState<Record<string,string>>({});
  const sheet = sheets.find(s => s.name === config.sheet);
  function change(values: Partial<ImportConfig>, clearPreview = false) {
    setConfig(c => ({ ...c, ...values })); setDirty(true); setConfirmed(false); setError("");
    if (clearPreview) { setPreview(null); setPage(0); }
  }
  function form() {
    const data = new FormData(); if (file) data.set("file", file); data.set("config", JSON.stringify(config)); return data;
  }
  function run(work: () => Promise<void>) {
    start(async () => { setError(""); try { await work(); } catch { setError("Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen."); } });
  }
  function load() {
    run(async () => {
      const result = await inspectFile(slug, form());
      if (result.error) { setError(result.error); return; }
      if (!result.data) return;
      setSheets(result.data.sheets);
      const selected = result.data.sheets.length === 1 ? result.data.sheets[0] : result.data.sheets.find(s => s.name === "Käuferliste");
      change({ requestId: crypto.randomUUID(), sheet: selected?.name ?? "", mapping: selected?.mapping ?? {}, events: {}, excluded: [] }, true);
    });
  }
  function showPreview() {
    run(async () => {
      const result = await previewImport(slug, form());
      if (result.error) { setError(result.error); return; }
      if (result.data) { setPreview(result.data); setDirty(false); setConfirmed(false); setPage(0); }
    });
  }
  return <div className="space-y-6">
    <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">Datei prüfen, Spalten zuordnen, jedes Event ausdrücklich auswählen und Vorschau bestätigen. Es werden keine internen Tickets, Kundenkonten, Zahlungen oder Kundenmails erstellt. Externe Erstattungen werden dokumentiert und führen hier nicht zur Stornierung; die Plätze bleiben belegt.</p>
    {error && <p role="alert" className="rounded-lg border border-red-300 p-4 text-red-700 dark:text-red-300">{error}</p>}
    <fieldset disabled={pending} className={panel}><legend className="px-1 font-semibold">1. Datei und Quelle</legend>
      <div className="grid gap-4 sm:grid-cols-2"><label>Datei (.xlsx oder .csv)<input type="file" accept=".xlsx,.csv" className={control} onChange={e => { setFile(e.target.files?.[0] ?? null); setSheets([]); setPreview(null); setDirty(true); setConfirmed(false); }} /></label>
        <label>Buchungsquelle<select className={control} value={config.platform} onChange={e => change({ platform: e.target.value })}>{platforms.map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="sm:col-span-2">Importname / Quellenbezeichnung (optional)<input className={control} maxLength={160} value={config.name} onChange={e => change({ name: e.target.value })} /></label></div>
      <p className="text-sm text-zinc-500">Maximal 5 MiB, 1.000 Datenzeilen insgesamt, 80 Spalten und 10 Tabellenblätter. Erste nicht leere Zeile: eindeutige Spaltenüberschriften. Formeln bitte zuvor als Werte speichern. CSV: UTF-8 oder UTF-16LE mit BOM.</p>
      <button type="button" className={button} disabled={!file || file.size > 5 * 1024 * 1024} onClick={load}>Datei einlesen</button>
    </fieldset>
    {!!sheets.length && <fieldset disabled={pending} className={panel}><legend className="px-1 font-semibold">2. Tabellenblatt und Spalten prüfen</legend>
      <label className="block max-w-lg">Tabellenblatt<select className={control} value={config.sheet} onChange={e => { const s = sheets.find(s => s.name === e.target.value); change({ sheet: e.target.value, mapping: s?.mapping ?? {}, events: {}, excluded: [] }, true); }}><option value="">Bitte auswählen</option>{sheets.map(s => <option key={s.name} value={s.name}>{s.name} ({s.count} Zeilen)</option>)}</select></label>
      {sheet && <><p className="text-sm">Erkannte Spalten sind vorausgewählt. Bitte jede Zuordnung prüfen. Weitere Spalten werden nicht für die Buchung verwendet, bleiben aber im geschützten Importprotokoll erhalten.</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(Object.entries(fields) as [Field,string][]).map(([field,label]) => <label key={field} className="text-sm">{label}{["quantity","bookedAt","gross"].includes(field) ? " *" : ""}<select className={control} value={config.mapping[field] ?? ""} onChange={e => change({ mapping: { ...config.mapping, [field]: e.target.value }, events: {}, excluded: [] }, true)}><option value="">Nicht zugeordnet</option>{sheet.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>
        <p className="text-sm text-zinc-500">Beträge immer in Euro bzw. der Währungshaupteinheit, niemals als Centzahl. Ohne Währungsspalte gilt EUR. Datumswerte ohne Zeitzone gelten in Europe/Berlin. Ohne Eventspalten werden alle Zeilen gemeinsam einem manuell gewählten Event zugeordnet.</p>
        <button className={button} type="button" onClick={showPreview}>Event-Vorschläge und Vorschau laden</button></>}
    </fieldset>}
    {preview && <>
      <fieldset disabled={pending} className={panel}><legend className="px-1 font-semibold">3. Jedes Event verbindlich zuordnen</legend>
        <p className="text-sm">Vorschläge verwenden Titelähnlichkeit, Datum, Uhrzeit und Location innerhalb dieser Company. Auch bei einem eindeutigen Vorschlag ist Ihre Auswahl erforderlich. Es werden keine Events angelegt.</p>
        {preview.groups.map((g,index) => {
          const query = (eventQueries[g.key] ?? "").trim().toLocaleLowerCase("de-DE");
          const manual = preview.events.filter(e => !query || [e.name,e.id,e.location,formatDate(e.beginsAt)].join(" ").toLocaleLowerCase("de-DE").includes(query)).slice(0,100);
          const selected = preview.events.find(e => e.id === config.events[g.key]);
          return <div className="space-y-2 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800" key={g.key}><label htmlFor={`event-mapping-${index}`}><span className="font-medium">{g.title}</span> · {formatDate(g.date)} {g.location && `· ${g.location}`}</label>
          <label className="block">Company-Events durchsuchen<input type="search" className={control} placeholder="Titel, Datum, Location oder Event-ID" value={eventQueries[g.key] ?? ""} onChange={e => setEventQueries(q => ({ ...q, [g.key]: e.target.value }))} /></label>
          <select id={`event-mapping-${index}`} className={control} value={config.events[g.key] ?? ""} onChange={e => change({ events: { ...config.events, [g.key]: e.target.value } })}><option value="">Bitte ausdrücklich auswählen oder sämtliche zugehörigen Zeilen ausschließen</option>
            {selected && !manual.some(e => e.id === selected.id) && !g.candidates.some(e => e.id === selected.id) && <option value={selected.id}>{selected.name} · {formatDate(selected.beginsAt)} · {selected.location ?? "Ohne Location"} · {selected.id}</option>}
            {!!g.candidates.length && <optgroup label="Vorschläge">{g.candidates.map(c => { const e = preview.events.find(e => e.id === c.id)!; return <option value={e.id} key={e.id}>{e.name} · {formatDate(e.beginsAt)} · {e.location ?? "Ohne Location"} · {e.id} ({c.score}/100)</option>; })}</optgroup>}
            <optgroup label="Company-Events (bis zu 100 Suchtreffer)">{manual.map(e => <option key={e.id} value={e.id}>{e.name} · {formatDate(e.beginsAt)} · {e.location ?? "Ohne Location"} · {e.id}</option>)}</optgroup>
          </select>
          <button type="button" className="mt-2 underline" onClick={() => change({ excluded: [...new Set([...config.excluded, ...preview.rows.filter(r => r.group === g.key).map(r => r.sourceRow)])] })}>Alle Zeilen dieses Quell-Events ausschließen</button>
        </div>; })}
        <button type="button" className={button} onClick={showPreview}>Zuordnung prüfen und Vorschau aktualisieren</button>
      </fieldset>
      <section className={panel} aria-labelledby="preview-title"><h2 className="text-xl font-semibold" id="preview-title">4. Vorschau</h2>
        {dirty && <p role="status" className="text-amber-700 dark:text-amber-300">Einstellungen geändert. Bitte Vorschau aktualisieren; angezeigte Ergebnisse sind noch vom vorherigen Stand.</p>}
        <ul className="flex flex-wrap gap-4 text-sm">{Object.entries(labels).map(([state,label]) => <li key={state}>{label}: {preview.rows.filter(r => r.state === state).length}</li>)}</ul>
        {!!preview.capacity.length && <div role="alert" className="text-red-700 dark:text-red-300"><p className="font-semibold">Kapazität überschritten</p>{preview.capacity.map(s => <p key={s}>{s}</p>)}</div>}
        <p className="text-sm">Fehlerhafte Quellwerte bitte in der Datei korrigieren und erneut einlesen oder betreffende Zeilen ausdrücklich ausschließen. Duplikate mit externer ID werden übersprungen. Warnungen bitte vor der Bestätigung prüfen.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Normalisierte Importzeilen</caption><thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Ausschließen","Zeile","Event","Name / E-Mail","Tickets","Buchungsdatum","Brutto","Externe ID","Buchungsstatus / Erstattung","Ergebnis"].map(h => <th scope="col" className="p-3" key={h}>{h}</th>)}</tr></thead>
          <tbody>{preview.rows.slice(page * 50, (page + 1) * 50).map(r => <tr key={r.sourceRow} className="border-t border-zinc-200 align-top dark:border-zinc-800">
            <td className="p-3"><input type="checkbox" aria-label={`Zeile ${r.sourceRow} ausschließen`} disabled={pending} checked={config.excluded.includes(r.sourceRow)} onChange={e => change({ excluded: e.target.checked ? [...config.excluded,r.sourceRow] : config.excluded.filter(n => n !== r.sourceRow) })} /></td>
            <th scope="row" className="p-3">{r.sourceRow}</th><td className="p-3">{r.eventName ?? "Nicht zugeordnet"}</td><td className="p-3"><p>{r.normalized.customerName ?? "—"}</p><p className="break-all text-zinc-500">{r.normalized.customerEmail}</p></td><td className="p-3">{r.normalized.quantity}</td><td className="whitespace-nowrap p-3">{formatDate(r.normalized.bookedAt)}</td>
            <td className="whitespace-nowrap p-3">{(r.normalized.gross / 100).toFixed(2)} {r.normalized.currency}</td><td className="break-all p-3">{r.normalized.externalId ?? "—"}</td><td className="p-3">{bookingStatuses[r.normalized.status]}{r.normalized.refund != null && <p>Extern erstattet: {(r.normalized.refund / 100).toFixed(2)} {r.normalized.currency}</p>}{r.normalized.refundedAt && <p>{formatDate(r.normalized.refundedAt)}</p>}</td>
            <td className="min-w-64 p-3"><strong>{labels[r.state]}</strong>{r.errors.map((s,i) => <p key={`e${i}`} className="text-red-700 dark:text-red-300">{s}</p>)}{r.warnings.map((s,i) => <p key={`w${i}`} className="text-amber-700 dark:text-amber-300">{s}</p>)}</td>
          </tr>)}</tbody></table></div>
        <div className="flex items-center gap-4"><button type="button" className="underline disabled:opacity-40" disabled={page === 0} onClick={() => setPage(p => p-1)}>Vorherige</button><span>Seite {page+1} / {Math.max(1,Math.ceil(preview.rows.length/50))}</span><button type="button" className="underline disabled:opacity-40" disabled={(page+1)*50 >= preview.rows.length} onClick={() => setPage(p => p+1)}>Nächste</button></div>
        <button type="button" disabled={pending} className={button} onClick={showPreview}>Vorschau aktualisieren</button>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={pending || dirty || !preview.canCommit} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>Ich habe alle Event-Zuordnungen, Warnungen und Ausschlüsse geprüft. Ich bestätige die externen Buchungen und die dauerhafte Speicherung der Zellwerte im Company-Importprotokoll. Unnötige sensible Spalten habe ich vor dem Hochladen entfernt.</span></label>
        <button type="button" className={button} disabled={pending || dirty || !preview.canCommit || !confirmed} onClick={() => run(async () => { const data = form(); data.set("previewHash",preview.hash); data.set("confirmed","yes"); const result = await confirmImport(slug,data); if (result.error) { setError(result.error); setDirty(true); setConfirmed(false); } else if (result.data) router.push(`/company/${encodeURIComponent(slug)}/bookings/imports/${encodeURIComponent(result.data.id)}`); })}>Import verbindlich bestätigen</button>
      </section>
    </>}
    {pending && <p role="status" aria-live="polite">Import wird verarbeitet …</p>}
  </div>;
}
