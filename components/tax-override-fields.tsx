"use client";
import { useEffect, useRef, useState } from "react";
import { loadTaxEditor } from "@/lib/taxes/actions";
export function TaxOverrideFields({ slug, kind, id = null, venueId = "", seriesId = "" }: { slug: string; kind: "event" | "series"; id?: string | null; venueId?: string; seriesId?: string }) {
 const [config, setConfig] = useState<Awaited<ReturnType<typeof loadTaxEditor>>>(null);
 const [mode, setMode] = useState("automatic"), [rate, setRate] = useState("");
 const initialized = useRef(false);
 const initialValues = useRef("[]");
 useEffect(() => {
  let active = true;
  loadTaxEditor(slug, kind, id, venueId, seriesId).then(result => {
   if (!active) return;
   setConfig(result);
   if (result && !initialized.current) { initialValues.current = JSON.stringify(result.rate == null ? [["taxMode", "automatic"]] : [["taxMode", "override"], ["taxRate", result.rate]]); setMode(result.rate == null ? "automatic" : "override"); setRate(result.rate ?? ""); initialized.current = true; }
  }).catch(() => { if (active) setConfig(null); });
  return () => { active = false; };
 }, [slug, kind, id, venueId, seriesId]);
 if (!config) return null;
 const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";
 return <div data-unsaved-initial-values={initialValues.current} className="space-y-3 sm:col-span-2"><p className="font-medium">Steuersatz</p>
  <p className="text-sm text-zinc-500">{mode === "automatic" ? config.automatic : `Expliziter Override: ${rate || "offen"} %`}</p>
  <label className="block">Steuer-Modus<select name="taxMode" value={mode} onChange={e => setMode(e.target.value)} className={input}><option value="automatic">Automatisch nach Venue/Veranstaltungsreihe</option><option value="override">Expliziter Steuersatz</option></select></label>
  {mode === "override" && <label className="block">Steuersatz (%)<input name="taxRate" value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" maxLength={8} className={input} /></label>}
  {kind === "series" && <p className="text-xs text-zinc-500">Änderungen gelten dynamisch für Events ohne eigenen Override. Individuelle Overrides werden nicht überschrieben.</p>}
 </div>;
}
