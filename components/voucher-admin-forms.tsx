"use client";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { saveCampaign, setCampaignStatus, createCodes, editCode, setCodeStatus } from "@/app/company/[companyKey]/vouchers/actions";
import type { TargetOptions, VoucherAdminState } from "@/lib/vouchers/admin-validation";

const input = "mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const button = "rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const eventDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

function FieldInfo({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  return <span className="inline-flex items-center gap-2">
    <button type="button" aria-label={`Erklärung zu ${label}`} aria-expanded={open} aria-controls={descriptionId}
      onClick={(event) => { event.preventDefault(); setOpen(value => !value); }}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-primary-300 text-xs font-bold leading-none text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:border-primary-700 dark:text-primary-300 dark:hover:bg-primary-950">
      i
    </button>
    {open && <span id={descriptionId} role="note" className="max-w-md rounded-md bg-primary-50 px-3 py-2 text-xs font-normal leading-relaxed text-zinc-700 shadow-sm dark:bg-primary-950 dark:text-zinc-200">{children}</span>}
  </span>;
}

function FieldLabel({ label, help, children }: { label: string; help: ReactNode; children: ReactNode }) {
  return <label className="block">
    <span className="flex flex-wrap items-center gap-2 font-medium"><span>{label}</span><FieldInfo label={label}>{help}</FieldInfo></span>
    {children}
  </label>;
}
export type CampaignFormValues = { id: string; name: string; description: string; kind: string; value: string; startsAt: string; endsAt: string;
  maxRedemptions: string; maxRedemptionsPerCustomer: string; maxEligibleTicketsPerBooking: string; source: string;
  companyIds: string[]; seriesIds: string[]; eventIds: string[]; venueIds: string[]; locked: boolean; archived: boolean };

export function VoucherCampaignForm({ slug, options, row, start, drawer = false, onSaved, onCancel }: { slug: string; options: TargetOptions; row?: CampaignFormValues; start: string; drawer?: boolean; onSaved?: (message: string) => void; onCancel?: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<VoucherAdminState, FormData>(async (previous, form) => {
    const result = await saveCampaign(slug, row?.id ?? null, previous, form);
    if (result.success) onSaved?.(result.message ?? "Kampagne gespeichert.");
    return result;
  }, {});
  const [kind, setKind] = useState(row?.kind ?? "PERCENTAGE");
  const [targets, setTargets] = useState({ companyIds: row?.companyIds ?? [], seriesIds: row?.seriesIds ?? [], eventIds: row?.eventIds ?? [], venueIds: row?.venueIds ?? [] });
  useEffect(() => {
    if (!drawer) return;
    const dialog = panel.current!;
    const previous = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus(); };
    open(); desktop.addEventListener("change", open);
    return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
  }, [drawer]);
  if (state.success && !row && !onSaved) return <div role="status" className="rounded-xl border border-emerald-300 p-5">{state.message} <Link className="underline" href={`/company/${slug}/vouchers/${state.campaignId}`}>Kampagne öffnen und Codes ausgeben</Link></div>;
  const locked = !!row?.locked;
  const form = <form action={action} className={drawer ? "space-y-5" : "space-y-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"}>
    <header className="flex items-center justify-between gap-4"><h2 id={drawer ? "voucher-campaign-form-title" : undefined} className="text-lg font-semibold">{row ? "Kampagne bearbeiten" : "Neue Kampagne"}</h2>{drawer && <button type="button" disabled={pending} aria-label="Formular schließen" onClick={onCancel} className="rounded p-2 text-xl">×</button>}</header>
    <fieldset disabled={pending || row?.archived} className="space-y-4">
      <FieldLabel label="Name" help="Der interne Name der Kampagne, zum Beispiel „Sommeraktion 2027“. Er wird nicht als Gutscheincode verwendet."><input className={input} name="name" required maxLength={160} defaultValue={row?.name} /></FieldLabel>
      <FieldLabel label="Interne Beschreibung" help="Notizen für die Verwaltung, etwa Zweck, Zielgruppe oder Ansprechpartner. Diese Beschreibung sehen Buchende nicht."><textarea className={input} name="description" maxLength={2000} defaultValue={row?.description} /></FieldLabel>
      {locked && <p className="text-sm text-zinc-500">Codes wurden bereits ausgegeben. Regeln und Ziele sind geschützt. Für andere Konditionen bitte eine neue Kampagne erstellen.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label="Gutscheinart" help="Prozent reduziert den Preis prozentual. Ein fester Rabatt zieht einmalig einen Eurobetrag ab. Wertguthaben speichert einen Betrag, der auch auf mehrere Buchungen verteilt eingesetzt werden kann."><select className={input} name="kind" value={kind} onChange={e => setKind(e.target.value)} disabled={locked}>
          <option value="PERCENTAGE">Prozentualer Rabatt</option><option value="FIXED_AMOUNT">Fester Euro-Rabatt</option><option value="STORED_VALUE">Wertguthaben</option>
        </select>{locked && <input type="hidden" name="kind" value={kind} />}</FieldLabel>
        <FieldLabel label={kind === "PERCENTAGE" ? "Rabatt in %" : kind === "STORED_VALUE" ? "Ausgabewert je Gutschein in EUR" : "Rabatt in EUR"}
          help={kind === "PERCENTAGE" ? "Prozentsatz zwischen 0,01 und 100. Beispiel: 20 bedeutet 20 % Rabatt." : kind === "STORED_VALUE" ? "Startguthaben jedes neu ausgegebenen Wertgutscheins. Beispiel: 50 bedeutet 50,00 EUR pro Code." : "Eurobetrag, der einmal pro Buchung abgezogen wird. Ein nicht benötigter Rest wird nicht gespeichert."}>
          <input className={input} name="value" required inputMode="decimal" defaultValue={row?.value ?? "10"} readOnly={locked} />
        </FieldLabel>
        <FieldLabel label="Beginn (Europe/Berlin)" help="Ab diesem Zeitpunkt darf die Kampagne für neue Buchungen verwendet werden. Bereits reservierte Einlösungen behalten ihren gespeicherten Stand."><input className={input} type="datetime-local" step="0.001" name="startsAt" required defaultValue={row?.startsAt ?? start} readOnly={locked} /></FieldLabel>
        <FieldLabel label="Ende (optional, Europe/Berlin)" help="Nach diesem Zeitpunkt sind keine neuen Einlösungen mehr möglich. Leer bedeutet: kein festes Kampagnenende."><input className={input} type="datetime-local" step="0.001" name="endsAt" defaultValue={row?.endsAt} readOnly={locked} /></FieldLabel>
        <FieldLabel label="Gesamtlimit (leer = unbegrenzt)" help="Maximale Zahl wirksamer Einlösungen der gesamten Kampagne über alle Codes hinweg. Reservierte Einlösungen zählen mit; vollständig rückabgewickelte Einlösungen geben das Limit wieder frei."><input className={input} type="number" min="1" step="1" name="maxRedemptions" defaultValue={row?.maxRedemptions} readOnly={locked} /></FieldLabel>
        <FieldLabel label="Limit je Kundenidentität" help="Wie oft dieselbe Person diese Kampagne insgesamt nutzen darf – auch mit verschiedenen Codes. Bei eingeloggten Personen zählt das Konto, bei Gästen nur die normalisierte Buchungs-E-Mail als weiche Begrenzung."><input className={input} type="number" min="1" step="1" name="maxRedemptionsPerCustomer" defaultValue={row?.maxRedemptionsPerCustomer} readOnly={locked} /></FieldLabel>
        <FieldLabel label="Rabattfähige Tickets je Buchung" help="Begrenzt, auf wie viele Tickets einer Buchung der Rabatt angewendet wird. Beispiel: 1 bei 100 % Rabatt macht genau ein Ticket kostenlos; weitere Tickets werden normal berechnet. Für Wertguthaben leer lassen."><input className={input} type="number" min="1" step="1" name="maxEligibleTicketsPerBooking" defaultValue={row?.maxEligibleTicketsPerBooking} readOnly={locked} /></FieldLabel>
        <FieldLabel label="Tracking-Quelle der Kampagne" help="Interne Kennzeichnung für Auswertungen, zum Beispiel „Instagram Sommer 2027“ oder „Partnerverein“. Sie ändert den Rabatt nicht und ist kein Gutscheincode."><input className={input} name="source" maxLength={160} defaultValue={row?.source} readOnly={locked} /></FieldLabel>
      </div>
      <input type="hidden" name="currency" value="EUR" />
      <p className="text-sm text-zinc-500">Währung: EUR. Bei 100 % Rabatt ist ohne Ticketlimit genau ein Ticket kostenlos. Wertguthaben hat kein Ticketlimit. Gäste werden nur weich über ihre Buchungs-E-Mail begrenzt.</p>
      <div className="space-y-4">
        {options.companies.map(company => <div key={company.id} className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 font-medium"><input type="checkbox" name="companyIds" value={company.id} checked={targets.companyIds.includes(company.id)} onChange={event => setTargets(old => ({ ...old, companyIds: event.target.checked ? [company.id] : [] }))} disabled={locked} />Gesamtes Unternehmen</label><FieldInfo label="Gesamtes Unternehmen">Wählt alle bestehenden und später angelegten Events von {company.name} aus.</FieldInfo>{locked && targets.companyIds.map(id => <input key={id} type="hidden" name="companyIds" value={id} />)}</div>)}
        {([
          ["seriesIds", "Veranstaltungsreihen", options.series, "Die Kampagne gilt für alle Events, die einer ausgewählten Veranstaltungsreihe zugeordnet sind. Später zugeordnete Events werden ebenfalls erfasst."],
          ["eventIds", "Einzelne Events", options.events, "Die Kampagne gilt nur für die konkret ausgewählten einzelnen Events. Andere Events derselben Company oder Reihe sind dadurch nicht automatisch enthalten."],
          ["venueIds", "Venues", options.venues, "Die Kampagne gilt für Events, deren tatsächlich zugewiesene Venue ausgewählt ist. Später dort stattfindende Events werden ebenfalls erfasst."],
        ] as const).map(([key, label, choices, help]) => <details key={key} className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <summary className="cursor-pointer select-none px-4 py-3 font-medium">{label} <span className="text-sm font-normal text-zinc-500">({targets[key].length} ausgewählt)</span></summary>
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800"><div className="mb-3"><FieldInfo label={label}>{help}</FieldInfo></div><div className="max-h-64 space-y-2 overflow-y-auto">
            {choices.map(choice => <label key={choice.id} className="flex items-start gap-2 text-sm"><input type="checkbox" name={key} value={choice.id} checked={targets[key].includes(choice.id)} onChange={event => setTargets(old => ({ ...old, [key]: event.target.checked ? [...old[key], choice.id] : old[key].filter(id => id !== choice.id) }))} disabled={locked} /><span>{key === "seriesIds" && "number" in choice ? `#${choice.number} · ${choice.name || "Unbenannt"}` : key === "eventIds" && "number" in choice && "beginsAt" in choice ? `#${choice.number} · ${choice.name || "Unbenannt"} · ${choice.beginsAt ? eventDate.format(choice.beginsAt) : "Beginn offen"}` : choice.name || "Unbenannt"}</span></label>)}
            {!choices.length && <p className="text-sm text-zinc-500">Keine Ziele verfügbar.</p>}
            {locked && targets[key].map(id => <input key={id} type="hidden" name={key} value={id} />)}
          </div></div>
        </details>)}
      </div>
      <p className="text-sm text-zinc-500">Ziele gelten per ODER; Überschneidungen erhöhen den Rabatt nicht. Company-, Reihen- und Venue-Ziele erfassen auch spätere Zuordnungen. Wertguthaben ist auf die ausstellende Company beschränkt. Ein Entwurf darf ohne Ziel gespeichert, aber nicht aktiviert oder mit Codes ausgestattet werden.</p>
      <div className="flex gap-3"><button className={button} disabled={pending || row?.archived}>{pending ? "Wird gespeichert …" : "Kampagne speichern"}</button>{drawer && <button type="button" disabled={pending} onClick={onCancel} className="text-sm underline">Abbrechen</button>}</div>
    </fieldset>
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
  if (!drawer) return form;
  return <dialog ref={panel} aria-labelledby="voucher-campaign-form-title" onCancel={(event) => { event.preventDefault(); if (!pending) onCancel?.(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-lg overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-[32rem] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">{form}</dialog>;
}

export function VoucherStatusForm({ slug, campaignId, status, codeId }: { slug: string; campaignId: string; status: string; codeId?: string }) {
  const fn = codeId ? setCodeStatus.bind(null, slug, campaignId, codeId) : setCampaignStatus.bind(null, slug, campaignId);
  const [state, action, pending] = useActionState<VoucherAdminState, FormData>(fn, {});
  if (status === "ARCHIVED") return <span className="text-sm text-zinc-500">Archiviert</span>;
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <label className="inline-flex items-center gap-2 text-sm font-medium" htmlFor={`status-${codeId ?? campaignId}`}>Neuer Status
      <FieldInfo label="Neuer Status">{codeId ? "Aktiv erlaubt neue Einlösungen. Gesperrt stoppt neue Einlösungen vorübergehend. Archivieren ist endgültig und steht bei ausgegebenem Wertguthaben nicht zur Verfügung." : "Aktiv erlaubt neue Einlösungen. Pausiert stoppt sie vorübergehend. Archivieren ist endgültig; bereits ausgegebenes Wertguthaben kann nur pausiert werden."}</FieldInfo>
    </label>
    <select id={`status-${codeId ?? campaignId}`} className="rounded-lg border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700" name="status" defaultValue={status === "DRAFT" ? "ACTIVE" : status} disabled={pending}>
      <option value="ACTIVE">Aktiv</option><option value={codeId ? "DISABLED" : "PAUSED"}>{codeId ? "Gesperrt" : "Pausiert"}</option><option value="ARCHIVED">Archivieren (endgültig)</option>
    </select><button className={button} disabled={pending}>Status speichern</button>
    {state.message && <p role="status" className="w-full text-sm">{state.message}</p>}
  </form>;
}

type VoucherCodeRow = { id: string; mode: string; source: string | null; codeSuffix: string | null; status: string };
const codeStatuses: Record<string, string> = { ACTIVE: "Aktiv", DISABLED: "Gesperrt", ARCHIVED: "Archiviert" };
const codeStatusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  DISABLED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ARCHIVED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};
function CodeStatusTag({ status }: { status: string }) { return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${codeStatusColors[status] ?? codeStatusColors.ARCHIVED}`}>{codeStatuses[status] ?? status}</span>; }
function VoucherCodeEditForm({ slug, campaignId, code, onSaved, onCancel }: { slug: string; campaignId: string; code: VoucherCodeRow; onSaved: (message: string) => void; onCancel: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<VoucherAdminState, FormData>(async (previous, form) => {
    const result = await editCode(slug, campaignId, code.id, previous, form);
    if (result.success) onSaved(result.message ?? "Code gespeichert.");
    return result;
  }, {});
  useEffect(() => {
    const dialog = panel.current!, previous = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLInputElement>('input[name="source"]')?.focus(); };
    open(); desktop.addEventListener("change", open);
    return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={panel} aria-labelledby="voucher-code-edit-title" onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
    <form action={action} className="space-y-5"><header className="flex items-center justify-between gap-4"><h2 id="voucher-code-edit-title" className="text-lg font-semibold">Code bearbeiten</h2><button type="button" disabled={pending} aria-label="Codeformular schließen" onClick={onCancel} className="rounded p-2 text-xl">×</button></header>
      <p className="text-sm text-zinc-500">{code.mode === "PUBLIC" ? "Öffentlicher Mehrfachcode" : "Individueller Code"} · bisherige Endzeichen: <span className="font-mono">{code.codeSuffix ?? "—"}</span></p>
      <fieldset disabled={pending} className="space-y-4">
        <FieldLabel label="Trackingquelle des Codes" help="Interne Herkunft dieses Codes, zum Beispiel ein Influencer oder Vertriebskanal. Sie ändert die Kampagnenregeln nicht."><input className={input} name="source" maxLength={160} defaultValue={code.source ?? ""} /></FieldLabel>
        <FieldLabel label="Neuer Code (optional)" help="Der bisherige Klartext kann aus Sicherheitsgründen nicht angezeigt werden. Leer lassen, um ihn beizubehalten. Ein neuer Wert ersetzt den bisherigen Code und muss global eindeutig sein."><input className={`${input} font-mono`} name="newCode" minLength={8} maxLength={128} autoComplete="off" spellCheck={false} /></FieldLabel>
        <FieldLabel label="Code-Status" help="Aktiv erlaubt neue Einlösungen, Gesperrt stoppt sie vorübergehend. Archivieren ist endgültig und bei Wertgutscheinen nicht verfügbar."><select className={input} name="status" defaultValue={code.status}><option value="ACTIVE">Aktiv</option><option value="DISABLED">Gesperrt</option><option value="ARCHIVED">Archiviert</option></select></FieldLabel>
      </fieldset>
      {state.message && <p role={state.success ? "status" : "alert"} className="text-sm">{state.message}</p>}
      <div className="flex gap-3"><button className={button} disabled={pending}>{pending ? "Wird gespeichert …" : "Speichern"}</button><button type="button" disabled={pending} onClick={onCancel} className="text-sm underline">Abbrechen</button></div>
    </form>
  </dialog>;
}
function VoucherCodeIssueDrawer({ slug, campaignId, stored, requestId, onCancel }: { slug: string; campaignId: string; stored: boolean; requestId: string; onCancel: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = panel.current!, previous = document.activeElement as HTMLElement | null;
    const desktop = window.matchMedia("(min-width: 1280px)");
    const open = () => { dialog.close(); if (desktop.matches) dialog.show(); else dialog.showModal(); dialog.querySelector<HTMLElement>("select")?.focus(); };
    open(); desktop.addEventListener("change", open);
    return () => { desktop.removeEventListener("change", open); dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={panel} aria-labelledby="voucher-code-issue-title" onCancel={event => { event.preventDefault(); onCancel(); }} className="fixed inset-y-0 left-auto right-0 z-50 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white p-6 text-zinc-950 shadow-xl backdrop:bg-black/40 xl:w-96 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
    <header className="mb-5 flex items-center justify-between gap-4"><h2 id="voucher-code-issue-title" className="text-lg font-semibold">Code hinzufügen</h2><button type="button" aria-label="Codeausgabe schließen" onClick={onCancel} className="rounded p-2 text-xl">×</button></header>
    <VoucherIssueForm slug={slug} campaignId={campaignId} stored={stored} requestId={requestId} embedded onCancel={onCancel} />
  </dialog>;
}
type CodeEditor = { kind: "issue" } | { kind: "edit"; code: VoucherCodeRow };
export function VoucherCodesTable({ slug, campaignId, campaignName, codes, stored, canCreate, requestId, activeCodes, totalCodes }: { slug: string; campaignId: string; campaignName: string; codes: VoucherCodeRow[]; stored: boolean; canCreate: boolean; requestId: string; activeCodes: number; totalCodes: number }) {
  const [editor, setEditor] = useState<CodeEditor | null>(null), [message, setMessage] = useState(""), [issueId, setIssueId] = useState(requestId);
  function saved(value: string) { setEditor(null); setMessage(value); }
  function closeIssue() { setEditor(null); setIssueId(globalThis.crypto.randomUUID()); }
  return <>{<header className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-lg font-semibold">Codes · {activeCodes} aktiv / {totalCodes} erzeugt</h2>{canCreate && <button type="button" disabled={!!editor} onClick={() => { setEditor({ kind: "issue" }); setMessage(""); }} className={button}>+ Code hinzufügen</button>}</header>}
    {message && <p role="status" className="text-sm text-green-700 dark:text-green-300">{message}</p>}
    {editor?.kind === "edit" && <VoucherCodeEditForm key={editor.code.id} slug={slug} campaignId={campaignId} code={editor.code} onSaved={saved} onCancel={() => setEditor(null)} />}
    {editor?.kind === "issue" && <VoucherCodeIssueDrawer key={issueId} slug={slug} campaignId={campaignId} stored={stored} requestId={issueId} onCancel={closeIssue} />}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Codes der Kampagne {campaignName}</caption><thead className="bg-zinc-100 text-xs dark:bg-zinc-900"><tr>{["Code-Modus", "Trackingquelle des Codes", "Letzte 4 Zeichen", "Code-Status", "Aktionen"].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
      <tbody>{codes.map(code => <tr key={code.id} className="border-t border-zinc-200 align-top dark:border-zinc-800"><td className="px-4 py-4">{code.mode === "PUBLIC" ? "Öffentlicher Mehrfachcode" : "Individueller Code"}</td><td className="px-4 py-4">{code.source ?? "—"}</td><td className="px-4 py-4 font-mono">{code.codeSuffix ?? "—"}</td><td className="px-4 py-4"><CodeStatusTag status={code.status} /></td><td className="px-4 py-3"><button type="button" disabled={!!editor || code.status === "ARCHIVED"} title={code.status === "ARCHIVED" ? "Archivierte Codes sind schreibgeschützt" : "Code bearbeiten"} aria-label={`Code mit Endzeichen ${code.codeSuffix ?? "unbekannt"} bearbeiten`} onClick={() => { setEditor({ kind: "edit", code }); setMessage(""); }} className="rounded-lg p-2 text-primary-700 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5" /></svg></button></td></tr>)}</tbody>
    </table></div>{!codes.length && <p>Keine Codes auf dieser Seite.</p>}
  </>;
}

export function VoucherIssueForm({ slug, campaignId, stored, requestId, embedded = false, onCancel }: { slug: string; campaignId: string; stored: boolean; requestId: string; embedded?: boolean; onCancel?: () => void }) {
  const [nonce] = useState(requestId);
  const [mode, setMode] = useState(stored ? "INDIVIDUAL" : "PUBLIC");
  const [state, action, pending] = useActionState<VoucherAdminState, FormData>(createCodes.bind(null, slug, campaignId), {});
  if (state.success) return <section className={`space-y-3 ${embedded ? "" : "rounded-xl border border-emerald-300 p-5"}`} aria-live="polite">
    {!embedded && <h2 className="text-lg font-semibold">Codeausgabe</h2>}<p>{state.message}</p>
    {!!state.codes?.length && <textarea aria-label="Einmalig angezeigte Gutscheincodes" className={`${input} font-mono`} rows={Math.min(state.codes.length + 1, 12)} readOnly value={state.codes.join("\n")} spellCheck={false} />}
    <p className="text-sm">Nur im vorgesehenen Empfängerkreis weitergeben. Nach Verlassen dieser Ansicht ist keine erneute Klartextanzeige möglich.</p>
    {onCancel ? <button type="button" onClick={onCancel} className="underline">Anzeige schließen</button> : <a className="underline" href={`/company/${encodeURIComponent(slug)}/vouchers/${encodeURIComponent(campaignId)}`}>Anzeige schließen / neue Ausgabe vorbereiten</a>}
  </section>;
  return <form action={action} className={`space-y-4 ${embedded ? "" : "rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"}`}>
    {!embedded && <h2 className="text-lg font-semibold">Codes ausgeben</h2>}
    <p className="text-sm text-zinc-500">{stored ? "Administrative Guthabenausgabe ohne Verkauf oder Zahlung. Das Guthaben wird pro Code ausgegeben." : "Mehrere öffentliche Mehrfachcodes und individuelle Einmalcodes können dieselbe Kampagne nutzen."} Klartextcodes werden nur einmal angezeigt.</p>
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="requestId" value={nonce} />
      <FieldLabel label="Code-Modus" help="Ein öffentlicher Mehrfachcode kann von mehreren Personen eingegeben werden, zum Beispiel SOMMER2027. Individuelle Codes werden zufällig erzeugt und getrennt verteilt. Wertgutscheine sind immer individuell."><select className={input} name="mode" value={mode} onChange={e => setMode(e.target.value)}>{!stored && <option value="PUBLIC">Öffentlicher Mehrfachcode</option>}<option value="INDIVIDUAL">Individuelle Codes</option></select></FieldLabel>
      <FieldLabel label="Anzahl (maximal 100)" help="Wie viele individuelle Codes in diesem Vorgang erzeugt werden. Öffentliche Wunschcodes werden einzeln ausgegeben; danach kann für dieselbe Kampagne direkt ein weiterer öffentlicher Code angelegt werden."><input className={input} name="count" type="number" min="1" max={mode === "PUBLIC" ? 1 : 100} defaultValue="1" required /></FieldLabel>
      <FieldLabel label="Öffentlicher Wunschcode (optional, mindestens 8 Zeichen)" help="Der Text, den Buchende eingeben, zum Beispiel SOMMER2027. Weitere öffentliche Codes können anschließend in derselben Kampagne angelegt werden. Wenn das Feld leer bleibt, wird ein sicherer Zufallscode erzeugt. Der vollständige Code ist später nicht erneut abrufbar."><input className={input} name="publicCode" minLength={8} maxLength={128} autoComplete="off" spellCheck={false} disabled={mode !== "PUBLIC"} /></FieldLabel>
      <FieldLabel label="Zusätzliches Nutzungslimit je Code" help="Begrenzt diesen einzelnen Code zusätzlich zum Gesamtlimit der Kampagne. Das kleinere verbleibende Limit gewinnt. Individuelle Rabattcodes sind standardmäßig einmal nutzbar; Wertgutscheine können über mehrere Buchungen teilweise verwendet werden."><input className={input} type="number" min="1" name="maxRedemptions" placeholder={stored ? "Unbegrenzt / Teileinsätze" : mode === "INDIVIDUAL" ? "1" : "Unbegrenzt"} /></FieldLabel>
      <FieldLabel label="Empfänger-User-ID (optional)" help="Bindet den Code an ein bestimmtes Benutzerkonto. Nur dieses eingeloggte Konto kann ihn einlösen. Leer lassen, wenn der Code ohne Kontobindung funktionieren soll."><input className={input} name="assignedUserId" maxLength={191} autoComplete="off" /></FieldLabel>
      <FieldLabel label="Tracking-Quelle des Codes" help="Interne Herkunft dieses Codes oder Batches, zum Beispiel der Name eines Influencers oder Vertriebskanals. Sie dient nur der Auswertung."><input className={input} name="source" maxLength={160} /></FieldLabel>
      {stored ? <FieldLabel label="Guthaben gültig bis (optional, Europe/Berlin)" help="Nach diesem Zeitpunkt kann verbleibendes Guthaben nicht mehr für neue Buchungen eingesetzt werden. Eine spätere Stornierung stellt Guthaben mit genau diesem ursprünglichen Ablaufdatum wieder her."><input className={input} type="datetime-local" step="0.001" name="expiresAt" /></FieldLabel> : <input type="hidden" name="expiresAt" value="" />}
      <p className="text-sm text-zinc-500">Empfängerbindung erfordert beim Einlösen den Login dieses Kontos. Company-Admins können nur bekannte Konten aus ihrer Company oder deren Buchungen binden.</p>
      <button className={`${button} sm:col-span-2`} disabled={pending}>{pending ? "Ausgabe läuft …" : stored ? "Guthaben verbindlich ausgeben" : "Codes erstellen"}</button>
    </fieldset>
    {state.message && <p role="alert" className="text-sm">{state.message}</p>}
  </form>;
}
