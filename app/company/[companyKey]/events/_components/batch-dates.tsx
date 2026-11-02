"use client";

import { useEffect, useState } from "react";
import { getSeriesDateConflicts } from "../actions";
import { addCalendarDays, batchOccurrence, berlinCalendarDate, calendarRange, MAX_BATCH_EVENTS, type BatchSelection } from "@/lib/company-events/batch-schedule";

const input = "mt-1 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const dayLabel = (day: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const timeLabel = (iso: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(iso));
const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function BatchDates({ slug, seriesId, value, onChange, suggestedDuration, conflictingDates = [], dateErrors = {} }: {
  slug: string; seriesId: string; value: BatchSelection; onChange: (value: BatchSelection) => void;
  suggestedDuration: number | null; conflictingDates?: string[]; dateErrors?: Record<string, string>;
}) {
  const [range, setRange] = useState(() => { const from = value.dates[0] ?? berlinCalendarDate(new Date()); return { from, to: addCalendarDays(from, 27) }; });
  const [page, setPage] = useState(0);
  const [availability, setAvailability] = useState<{ key: string; dates: string[]; message?: string } | null>(null);
  const rangeDates = calendarRange(range.from, range.to);
  const rangeKey = `${slug}:${seriesId}:${range.from}:${range.to}`;
  useEffect(() => {
    if (!calendarRange(range.from, range.to).length) return;
    let active = true;
    const timeout = setTimeout(() => {
      getSeriesDateConflicts(slug, seriesId, range.from, range.to).then(result => {
        if (active) setAvailability({ key: rangeKey, ...result });
      }).catch(() => { if (active) setAvailability({ key: rangeKey, dates: [], message: "Belegte Tage konnten nicht geladen werden. Bereits vorhandene Events werden daher möglicherweise nicht angezeigt." }); });
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [slug, seriesId, range.from, range.to, rangeKey]);
  const occupied = new Set([...(availability?.key === rangeKey ? availability.dates : []), ...conflictingDates]);
  const conflicts = value.dates.filter(day => occupied.has(day));
  const outside = value.dates.filter(day => !rangeDates.includes(day));
  const firstMonday = rangeDates.length ? addCalendarDays(range.from, -((new Date(`${range.from}T00:00:00Z`).getUTCDay() + 6) % 7)) : null;
  const lastWeekOffset = firstMonday && rangeDates.length ? Math.floor((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${firstMonday}T00:00:00Z`)) / (7 * 86400000)) : 0;
  const pages = Math.floor(lastWeekOffset / 6) + 1;
  const currentPage = Math.min(page, pages - 1);
  const visibleDays = firstMonday ? Array.from({ length: Math.min(6, lastWeekOffset + 1 - currentPage * 6) * 7 }, (_, index) => addCalendarDays(firstMonday, currentPage * 42 + index)) : [];
  function toggle(day: string) {
    onChange({ ...value, dates: value.dates.includes(day) ? value.dates.filter(item => item !== day) : [...value.dates, day].sort() });
  }
  return <section aria-labelledby="batch-dates-title" className="space-y-4 rounded-xl border border-primary-200 bg-primary-50/30 p-4 dark:border-primary-900 dark:bg-primary-950/20">
    <h3 id="batch-dates-title" className="font-semibold">Termine auswählen</h3>
    <p className="text-xs text-zinc-500">Montag bis Sonntag · Zeitraum bis 366 Tage · maximal {MAX_BATCH_EVENTS} Events je Speichervorgang. Alle Zeiten in Europe/Berlin.</p>
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 text-sm">Von<input type="date" value={range.from} onChange={event => { setRange({ ...range, from: event.target.value }); setPage(0); }} className={input} /></label>
      <label className="min-w-0 text-sm">Bis<input type="date" value={range.to} onChange={event => { setRange({ ...range, to: event.target.value }); setPage(0); }} className={input} /></label>
    </div>
    {!rangeDates.length ? <p role="alert" className="text-sm text-red-700">Bitte einen gültigen Zeitraum von höchstens 366 Tagen auswählen.</p> : <>
      <div className="flex items-center justify-between gap-2 text-sm">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded border px-2 py-1 disabled:opacity-40">← Zurück</button>
        <span>Seite {currentPage + 1} / {pages}</span>
        <button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Weiter →</button>
      </div>
      <div className="grid grid-cols-7 gap-1" aria-label="Terminauswahl Montag bis Sonntag">
        {weekdayLabels.map(label => <div key={label} className="py-1 text-center text-xs font-semibold">{label}</div>)}
        {visibleDays.map(day => {
          const selected = value.dates.includes(day), blocked = occupied.has(day), inRange = day >= range.from && day <= range.to;
          return <button key={day} type="button" aria-pressed={selected} aria-label={`${dayLabel(day)}${blocked ? " – bereits belegt" : ""}`} title={blocked ? "An diesem Tag gibt es bereits ein Event dieser Reihe." : dayLabel(day)}
            disabled={!inRange || !selected && value.dates.length >= MAX_BATCH_EVENTS} onClick={() => toggle(day)}
            className={`min-w-0 rounded-lg border py-2 text-center text-xs disabled:opacity-40 ${selected ? "border-primary-600 bg-primary-600 text-white" : blocked ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"}`}>
            {day.slice(8)}.{day.slice(5, 7)}.<span className="block text-[10px]">{blocked ? "belegt" : selected ? "✓" : " "}</span>
          </button>;
        })}
      </div>
      {availability?.key !== rangeKey ? <p role="status" className="text-xs text-zinc-500">Belegte Tage werden geprüft …</p> : availability.message && <p role="alert" className="text-xs text-amber-700">{availability.message}</p>}
    </>}
    {conflicts.length > 0 && <div role="alert" className="space-y-2 text-sm text-amber-800 dark:text-amber-200"><p>{conflicts.length} ausgewählte Termine sind bereits belegt. Beim Speichern wird an diesen Tagen jeweils ein zusätzliches Event angelegt.</p><button type="button" className="underline" onClick={() => onChange({ ...value, dates: value.dates.filter(day => !occupied.has(day)) })}>Belegte Termine entfernen</button></div>}
    {outside.length > 0 && <div className="text-sm text-amber-800 dark:text-amber-200"><p>{outside.length} ausgewählte Termine liegen außerhalb des angezeigten Zeitraums und bleiben in der Vorschau erhalten.</p><button type="button" className="underline" onClick={() => onChange({ ...value, dates: value.dates.filter(day => rangeDates.includes(day)) })}>Termine außerhalb des Zeitraums entfernen</button></div>}
    <div className="grid grid-cols-2 gap-3">
      <label className="text-sm">Beginn (Uhrzeit)<input type="time" name="batchStartTime" value={value.startTime} onChange={event => onChange({ ...value, startTime: event.target.value })} className={input} /></label>
      <label className="text-sm">Ende festlegen<select name="batchTimeMode" value={value.timeMode} onChange={event => onChange({ ...value, timeMode: event.target.value as BatchSelection["timeMode"] })} className={input}><option value="clock">Enduhrzeit</option><option value="duration">Dauer in Minuten</option></select></label>
      {value.timeMode === "duration" ? <label className="col-span-2 text-sm">Dauer in Minuten<input name="batchDuration" type="number" min={1} step={1} value={value.duration} onChange={event => onChange({ ...value, duration: event.target.value })} className={input} /></label> : <>
        <label className="text-sm">Ende (Uhrzeit)<input type="time" name="batchEndTime" value={value.endTime} onChange={event => onChange({ ...value, endTime: event.target.value })} className={input} /></label>
        <label className="text-sm">Endtag (Tage später)<input type="number" name="batchEndDayOffset" min={0} max={366} step={1} value={value.endDayOffset} onChange={event => onChange({ ...value, endDayOffset: event.target.value })} className={input} /><span className="text-xs text-zinc-500">0 = gleicher Tag, 1 = Folgetag</span></label>
      </>}
    </div>
    {suggestedDuration && <button type="button" className="text-xs underline" onClick={() => onChange({ ...value, timeMode: "duration", duration: String(suggestedDuration) })}>Dauer der Reihe übernehmen ({suggestedDuration} Min.)</button>}
    <p className="text-xs text-zinc-500">Bei der Zeitumstellung werden ungültige Uhrzeiten markiert. Doppelte Herbst-Uhrzeiten verwenden die erste Uhrzeit (Sommerzeit). Eine Dauer wird in tatsächlich verstrichenen Minuten berechnet.</p>
    <div className="flex items-center justify-between gap-2"><h4 aria-live="polite" className="text-sm font-semibold">{value.dates.length} Termine ausgewählt</h4>{value.dates.length > 0 && <button type="button" className="text-xs underline" onClick={() => onChange({ ...value, dates: [] })}>Auswahl leeren</button>}</div>
    <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
      {value.dates.map(day => {
        let label: string;
        let error = dateErrors[day];
        try { const occurrence = batchOccurrence(day, value); label = `${timeLabel(occurrence.beginsAt)} – ${occurrence.endsAt ? timeLabel(occurrence.endsAt) : "Ende noch offen"}`; }
        catch (cause) { label = dayLabel(day); error = cause instanceof Error ? cause.message : "Ungültiger Termin."; }
        return <li key={day} className="flex items-start justify-between gap-2 rounded-lg bg-white p-2 dark:bg-zinc-900"><input type="hidden" name="batchDate" value={day} /><span><span className="font-medium">{dayLabel(day)}</span><span className="block">{label}</span>{occupied.has(day) && <span className="block text-amber-700">Bereits belegt</span>}{error && <span className="block text-red-700 dark:text-red-300">{error}</span>}</span><button type="button" onClick={() => toggle(day)} aria-label={`${dayLabel(day)} entfernen`} className="px-2 py-1 underline">Entfernen</button></li>;
      })}
    </ul>
    {!value.dates.length && <p className="text-sm text-zinc-500">Wähle die gewünschten Tage in der Wochenmatrix aus.</p>}
  </section>;
}
