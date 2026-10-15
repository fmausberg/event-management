"use client";

import { useId, useState } from "react";
import { saveTrainer } from "@/app/company/[companyKey]/trainers/actions";
import type { TrainerOption, TrainerState } from "@/lib/trainers/validation";

const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
type Props = { slug: string; trainers: TrainerOption[]; value: string[]; onChange: (ids: string[]) => void; name: string; multiple?: boolean; errors?: string[]; legacyName?: string | null; onBusy: (busy: boolean) => void };

export function TrainerPicker({ slug, trainers, value, onChange, name, multiple, errors, legacyName, onBusy }: Props) {
  const id = useId();
  const [created, setCreated] = useState<TrainerOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ firstName: "", lastName: "", email: "" });
  const [state, setState] = useState<TrainerState>({});
  const options = [...trainers, ...created.filter((t) => !trainers.some((existing) => existing.id === t.id))];
  async function create() {
    setBusy(true); onBusy(true);
    try {
      const form = new FormData();
      Object.entries(draft).forEach(([key, text]) => form.set(key, text));
      const result = await saveTrainer(slug, null, {}, form);
      setState(result);
      if (result.success && result.trainer) {
        setCreated((old) => [...old, result.trainer!]);
        onChange(multiple ? [...value, result.trainer.id] : [result.trainer.id]);
        setEditing(false); setDraft({ firstName: "", lastName: "", email: "" });
      }
    } catch { setState({ message: "Der Trainer konnte nicht angelegt werden. Bitte versuche es erneut." }); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div className="space-y-2">
    {multiple ? value.map((selected) => <input key={selected} type="hidden" name={name} value={selected} />) : <input type="hidden" name={name} value={value[0] ?? ""} />}
    <label htmlFor={id}>Trainer{multiple ? "" : " (Vorgabe)"}</label>
    <select id={id} className={input} value={multiple ? "" : value[0] ?? ""} disabled={busy} aria-invalid={!!errors?.length} aria-describedby={errors?.length ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value ? multiple ? [...value, e.target.value] : [e.target.value] : [])}>
      <option value="">{multiple ? "Trainer hinzufügen …" : "Kein Trainer"}</option>
      {options.filter((t) => !multiple || !value.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName} ({t.email})</option>)}
    </select>
    {multiple && value.map((selected) => { const trainer = options.find((t) => t.id === selected); return <div key={selected} className="flex items-center justify-between gap-2 text-sm"><span>{trainer ? `${trainer.firstName} ${trainer.lastName}` : "Trainer nicht mehr verfügbar"}</span><button type="button" disabled={busy} className="underline" aria-label={`${trainer?.firstName ?? "Trainer"} entfernen`} onClick={() => onChange(value.filter((v) => v !== selected))}>Entfernen</button></div>; })}
    {!options.length && <p className="text-xs text-zinc-500">Diese Company hat noch keine Trainer. Lege hier den ersten an.</p>}
    {legacyName && <p className="text-xs text-amber-700 dark:text-amber-300">Bisheriger Freitext: {legacyName}. Beim Speichern wird er durch die Auswahl ersetzt. Ohne Auswahl wird er entfernt.</p>}
    {errors?.length && <p id={`${id}-error`} role="alert" className="text-sm text-red-700">{errors.join(" ")}</p>}
    {editing ? <div className="space-y-2 rounded-lg border border-zinc-300 p-3">
      <p className="text-sm font-medium">Neuen Trainer anlegen</p>
      {(["firstName", "lastName", "email"] as const).map((key) => <div key={key}><label htmlFor={`${id}-${key}`} className="text-sm">{key === "firstName" ? "Vorname" : key === "lastName" ? "Nachname" : "E-Mail-Adresse"}</label><input id={`${id}-${key}`} type={key === "email" ? "email" : "text"} maxLength={key === "email" ? 254 : 160} className={input} value={draft[key]} disabled={busy} aria-invalid={!!state.errors?.[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!busy) void create(); } }} />{state.errors?.[key] && <p className="text-xs text-red-700">{state.errors[key]?.join(" ")}</p>}</div>)}
      <p className="text-xs text-zinc-500">Der Trainer wird sofort für die Company angelegt, auch wenn du das Eventformular später abbrichst.</p>
      <div className="flex gap-3 text-sm"><button type="button" disabled={busy} onClick={() => void create()} className="underline">{busy ? "Wird angelegt …" : "Anlegen und auswählen"}</button><button type="button" disabled={busy} onClick={() => setEditing(false)} className="underline">Abbrechen</button></div>
    </div> : <button type="button" onClick={() => { setEditing(true); setState({}); }} className="text-sm underline">+ Neuen Trainer anlegen</button>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </div>;
}
