import type { AuditAction, AuditActorType, Prisma } from "@prisma/client";
import { auditEventPolicies, auditModelLabels, auditPolicies } from "@/lib/audit/policy";

export type AuditTableEntry = {
  id: string; model: string; recordId: string; recordNumber?: number | null; recordName?: string | null;
  occurredAt: Date; actorType: AuditActorType; actorUserId: string | null; actorEmail: string | null;
  action: AuditAction; changedFields: string[]; redactedFields: string[];
  before: Prisma.JsonValue; after: Prisma.JsonValue;
};
const actions = { CREATE: "Create", UPDATE: "Update", DELETE: "Delete" };
const actors = { USER: "Nutzer", SYSTEM: "System", ANONYMOUS: "Anonym", UNKNOWN: "Unbekannt" };
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "medium" });
function policyFor(model: string) {
  if (Object.hasOwn(auditEventPolicies, model)) return auditEventPolicies[model as keyof typeof auditEventPolicies];
  return Object.hasOwn(auditPolicies, model) ? auditPolicies[model as keyof typeof auditPolicies] : null;
}
function changedAttributes(entry: AuditTableEntry) {
  const policy = policyFor(entry.model);
  if (!policy) return "Keine freigegebenen Attribute";
  const labels: Readonly<Record<string, string>> = { ...policy.fields, ...policy.privateFields };
  return [...new Set([...entry.changedFields, ...entry.redactedFields])]
    .filter((field) => Object.hasOwn(labels, field)).map((field) => labels[field]).join(", ") || "Keine freigegebenen Attribute";
}
function jsonDetails(entry: AuditTableEntry) {
  const policy = policyFor(entry.model);
  const filter = (value: Prisma.JsonValue) => {
    if (!policy || value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([field]) => Object.hasOwn(policy.fields, field)));
  };
  const notRecorded = entry.redactedFields.filter((field) => policy && (Object.hasOwn(policy.fields, field) || Object.hasOwn(policy.privateFields, field)));
  return JSON.stringify({ before: filter(entry.before), after: filter(entry.after), ...(notRecorded.length ? { valuesNotRecorded: notRecorded } : {}) }, null, 2);
}

export function AuditTable({ entries, showTarget = false }: { entries: AuditTableEntry[]; showTarget?: boolean }) {
  return <div className="mt-4 overflow-x-auto">
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Änderungshistorie</caption>
      <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800"><tr>
        {["Timestamp", "Wer?", "Was?", ...(showTarget ? ["Zielobjekt"] : []), "Details"].map((label) => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {entries.map((entry) => <tr key={entry.id} className="align-top">
          <td className="whitespace-nowrap px-3 py-3"><time dateTime={entry.occurredAt.toISOString()}>{dateTime.format(entry.occurredAt)}</time><span className="block text-xs text-zinc-400">Europe/Berlin</span></td>
          <td className="px-3 py-3 break-all">{entry.actorType === "USER" ? entry.actorEmail ?? `Nutzer nicht mehr verfügbar (${entry.actorUserId ?? "ohne ID"})` : actors[entry.actorType]}</td>
          <td className="px-3 py-3">{actions[entry.action]}</td>
          {showTarget && <td className="min-w-48 px-3 py-3">
            <span className="block text-xs text-zinc-500">{auditModelLabels[entry.model] ?? entry.model}</span>
            <span className="break-words">{entry.recordNumber != null ? `#${entry.recordNumber} · ` : ""}{entry.recordName || (entry.model === "CompanyMembership" ? "Mitgliedschaft" : entry.recordId)}</span>
          </td>}
          <td className="min-w-64 px-3 py-3">
            <details className="group max-w-2xl">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3 transition-transform group-open:rotate-90"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className="min-w-0 text-xs">{changedAttributes(entry)}<span className="sr-only"> – JSON auf- oder zuklappen</span></span>
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-200 bg-white/60 p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950/40">{jsonDetails(entry)}</pre>
            </details>
          </td>
        </tr>)}
        {!entries.length && <tr><td colSpan={showTarget ? 5 : 4} className="px-3 py-4">Noch keine Einträge auf dieser Seite.</td></tr>}
      </tbody>
    </table>
  </div>;
}
