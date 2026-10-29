import type { EventRevenue } from "@/lib/bookings/revenue";

export function EventRevenueSummary({ revenue }: { revenue: EventRevenue }) {
  const money = (value: string) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value));
  const items = [
    { label: "Bruttoumsatz", value: revenue.gross, formula: "Summe der berücksichtigten Ticketverkäufe" },
    { label: "MwSt. (kalkulatorisch)", value: revenue.vat, formula: "19 % des Bruttoumsatzes" },
    { label: "Stripe-Gebühren (kalkulatorisch)", value: revenue.stripeFees, formula: "1,5 % vom Brutto + 0,25 € pro Buchung" },
    { label: "Nettoumsatz (kalkulatorisch)", value: revenue.net, formula: "Brutto − MwSt. − Stripe-Gebühren" },
  ];
  return <section aria-labelledby="event-revenue-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 id="event-revenue-title" className="font-semibold">Kalkulatorische Event-Umsatzübersicht</h2>
    <p className="mt-1 text-sm text-zinc-500">Interne Kalkulation für die Trainerbeteiligung · {revenue.bookingCount} berücksichtigte Buchungen. Alle Beträge in EUR, auf Cent gerundet.</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => <div key={item.label} className={`rounded-lg p-4 ${index === 3 ? "bg-primary-50 dark:bg-primary-950" : "bg-zinc-50 dark:bg-zinc-900"}`}>
        <dt className="text-sm text-zinc-600 dark:text-zinc-400">{item.label}</dt>
        <dd className="mt-2 text-2xl font-semibold tabular-nums">{money(item.value)}</dd>
        <dd className="mt-2 text-xs text-zinc-500">{item.formula}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-xs text-zinc-500">Basis: gespeicherte bezahlte Beträge bestätigter Buchungen. Buchungen ohne Zahlungsbetrag, offene, abgelaufene, stornierte und vollständig erstattete Buchungen zählen nicht mit. Die Gebühren sind pauschal kalkuliert, keine Stripe-Abrechnung.</p>
    {revenue.excludedCount > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{revenue.excludedCount} bestätigte Buchungen sind nicht eingerechnet: fehlende Beträge, andere Währung oder Teilrückerstattung ohne gespeicherten Restbetrag.</p>}
  </section>;
}
