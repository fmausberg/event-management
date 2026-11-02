import type { EventRevenue } from "@/lib/bookings/revenue";

export function EventRevenueSummary({ revenue }: { revenue: EventRevenue }) {
  const money = (value: string) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value));
  const items = [
    { label: "Umsatz zum Listenpreis", value: revenue.listGross, formula: "Alle bestätigten Tickets zum vollen Preis, vor Rabatten und Gutscheinen",
      difference: revenue.listDifference == null ? "Listenpreise fehlen oder liegen in einer anderen Währung vor." : `Differenz zum Bruttoumsatz: ${money(revenue.listDifference)}` },
    { label: "Bruttoumsatz", value: revenue.gross, formula: "Summe der berücksichtigten Ticketverkäufe" },
    { label: "MwSt. (kalkulatorisch)", value: revenue.vat, formula: `${revenue.vatRate} % des Bruttoumsatzes` },
    { label: "Stripe-Gebühren (kalkulatorisch)", value: revenue.stripeFees, formula: "1,5 % vom Brutto + 0,25 € pro Buchung" },
    { label: "Nettoumsatz (kalkulatorisch)", value: revenue.net, formula: "Brutto − MwSt. − Stripe-Gebühren" },
  ];
  return <section aria-labelledby="event-revenue-title" className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
    <h2 id="event-revenue-title" className="font-semibold">Kalkulatorische Event-Umsatzübersicht</h2>
    <p className="mt-1 text-sm text-zinc-500">Interne Kalkulation für die Trainerbeteiligung · {revenue.bookingCount} berücksichtigte Buchungen. Alle Beträge in EUR, auf Cent gerundet.</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {items.map((item, index) => <div key={item.label} className={`min-w-0 rounded-lg p-4 ${index === items.length - 1 ? "bg-primary-50 dark:bg-primary-950" : "bg-zinc-50 dark:bg-zinc-900"}`}>
        <dt className="text-sm text-zinc-600 dark:text-zinc-400">{item.label}</dt>
        <dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{item.value == null ? "Nicht verfügbar" : money(item.value)}</dd>
        <dd className="mt-2 text-xs text-zinc-500">{item.formula}</dd>
        {item.difference && <dd className="mt-2 text-sm font-medium">{item.difference}</dd>}
      </div>)}
    </dl>
    <p className="mt-4 text-xs text-zinc-500">Listenpreis: voller Buchungspreis aller bestätigten Buchungen, einschließlich kostenloser Buchungen. Ohne gespeicherten ursprünglichen Preis gilt der aktuelle Eventpreis × Ticketanzahl. Differenz = Listenpreis-Umsatz − Bruttoumsatz.</p>
    <p className="mt-2 text-xs text-zinc-500">Bruttoumsatz: gespeicherte bezahlte Beträge bestätigter Buchungen. Buchungen ohne Zahlungsbetrag, offene, abgelaufene, stornierte und vollständig erstattete Buchungen zählen hier nicht mit. Die Differenz kann deshalb neben Rabatten und Gutscheinen auch fehlende oder nicht berücksichtigte Zahlungsbeträge enthalten. Die Gebühren sind pauschal kalkuliert, keine Stripe-Abrechnung.</p>
    {revenue.excludedCount > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{revenue.excludedCount} bestätigte Buchungen sind nicht eingerechnet: fehlende Beträge, andere Währung oder Teilrückerstattung ohne gespeicherten Restbetrag.</p>}
  </section>;
}
