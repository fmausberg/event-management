"use client";
import { useState } from "react";
import { cancellationPolicyText } from "@/lib/cancellations/policy";

export function CancellationPolicyField({ name, value, onChange, error }: {
  name: string; value: string; onChange: (minutes: string) => void; error?: string[];
}) {
  const [unit, setUnit] = useState(60);
  return <div className="space-y-2">
    <label htmlFor={name} className="block text-sm">Kostenfreie Stornofrist (optional)</label>
    <input type="hidden" name={name} value={value} />
    <div className="flex gap-2">
      <input id={name} type="number" min="0" step="any" value={value === "" ? "" : Number(value) / unit} onChange={(e) => onChange(e.target.value === "" ? "" : String(Math.round(Number(e.target.value) * unit * 1000000) / 1000000))} placeholder="Deaktiviert" aria-invalid={!!error} aria-describedby={`${name}-help`} className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
      <select aria-label="Einheit der Stornofrist" value={unit} onChange={(e) => setUnit(Number(e.target.value))} className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value={60}>Stunden</option><option value={1440}>Tage</option></select>
    </div>
    <button type="button" onClick={() => onChange("")} className="text-xs underline">Selbststornierung deaktivieren</button>
    <p id={`${name}-help`} className="text-xs text-zinc-500">{cancellationPolicyText(value === "" ? null : Number(value))} Leer = deaktiviert; 0 = bis unmittelbar vor Beginn.</p>
    {error && <p role="alert" className="text-xs text-red-700">{error.join(" ")}</p>}
  </div>;
}
