import { connection } from "next/server";
import { RefreshStatusButton } from "@/components/refresh-status-button";
import { getStatusOverview, type ServiceState } from "@/lib/status/overview";

export const metadata = { title: "Plattformstatus", robots: { index: false, follow: false } };
export const runtime = "nodejs";

const labels: Record<ServiceState, string> = {
  healthy: "Erreichbar", slow: "Langsam", timeout: "Zeitüberschreitung", denied: "Zugriff verweigert",
  error: "Fehler", unconfigured: "Nicht konfiguriert", unchecked: "Nicht geprüft", disabled: "Deaktiviert",
};
function badge(state: ServiceState) {
  if (state === "healthy") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (["error", "denied"].includes(state)) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  if (["slow", "timeout", "unconfigured"].includes(state)) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export default async function StatusOverviewPage() {
  await connection();
  const { services, checkedAt } = await getStatusOverview();
  const core = services.slice(0, 4);
  const healthy = core.filter(service => service.state === "healthy").length;
  return <main className="min-w-0 flex-1 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-medium text-zinc-500">Systemübersicht</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Plattformstatus</h1><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Aktuelle Erreichbarkeit der angebundenen Dienste.</p></div>
        <RefreshStatusButton />
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="font-semibold">{healthy === core.length ? "Alle Kernchecks erfolgreich" : "Kernchecks mit Einschränkungen"}</p>
        <p className="mt-1 text-sm text-zinc-500">{healthy} von {core.length} Kernchecks ohne Auffälligkeiten · Prüfstand: <time dateTime={checkedAt}>{new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Berlin" }).format(new Date(checkedAt))}</time> (Berlin)</p>
      </div>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {services.map(service => <li key={service.name} className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="min-w-0 flex-1 basis-56"><h2 className="font-medium">{service.name}</h2><p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{service.detail}</p></div>
          <div className="flex flex-col items-end gap-2"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${badge(service.state)}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{labels[service.state]}</span>{service.durationMs !== undefined && <span className="text-xs tabular-nums text-zinc-500">{service.durationMs} ms</span>}</div>
        </li>)}
      </ul>
      <p className="text-xs leading-relaxed text-zinc-500">Momentaufnahme aus Sicht dieser Plattform, keine Verfügbarkeitsgarantie. Ergebnisse werden je App-Instanz 30 Sekunden zwischengespeichert. Ab 2 Sekunden gilt ein Kerncheck als langsam, nach 8 Sekunden als unklar wegen Zeitüberschreitung. Weitere Integrationen zeigen nur ihren Konfigurationsstand.</p>
    </div>
  </main>;
}
