# Manuelle Steuersaetze (Pilot)

## Konfiguration und Berechtigungen

Company-Einstellungen enthalten die Section **Steuersaetze**. Ausschliesslich aktive
COMPANY_ADMINs sowie Plattform-ADMINs gemaess `requireCompanyAdmin` verwalten die
Laenderregeln. COMPANY_USERs erhalten weder diese Konfiguration noch Steuersnapshot-
Details oder Steuer-/Nettosummen in der Umsatzansicht. Bestehende Brutto-, Listenpreis-
und Gebuehrenanzeigen bleiben erhalten. Steuerfelder in manipulierten Event-/Reihen-
Formularen erfordern ebenfalls einen erneuten serverseitigen Admin-Check.

`CompanyTaxRule` hat genau einen Datensatz pro Company und ISO-3166-1-alpha-2-Land.
Die vollstaendige ISO-Liste liegt in `lib/taxes/countries.ts`; das SQL-CHECK verwendet
identische Codes. Satz: Decimal(7,4), 0 bis 100 einschliesslich, bis vier Nachkommastellen.
Kein automatischer DE-/AT-Default. Entfernen einer Regel kann neue Buchungen bestehender
Events blockieren. Bestehende Buchungen werden dadurch nicht veraendert.

## Venue und Vererbung

Massgeblich ist ausschliesslich das tatsaechliche `Event.venueId`, niemals das
`suggestedVenueId` der Reihe. Venue und Reihe muessen zur Company des Events gehoeren;
das Venue braucht ein gueltiges Land, auch bei Overrides. Entwuerfe sind ohne Regel
speicherbar. Veroeffentlichung und Buchungen verlangen eine aufloesbare Konfiguration.

Prioritaet:
1. Event.taxRateOverride, sofern nicht null (auch explizite 0).
2. EventSeries.taxRateOverride, sofern nicht null (auch explizite 0).
3. CompanyTaxRule fuer das Land des Event-Venues.

Der Pilot verwendet die vereinfachte, dynamische Reihenvererbung: Nur Events mit
`taxRateOverride = null` erben den aktuellen Reihenwert. Es werden keine abgeleiteten
Werte als Event-Overrides gespeichert. Reihen-Aenderungen wirken auf neue Buchungen
dieser Events, ohne individuelle Overrides oder bestehende Buchungssnapshots zu
ueberschreiben. Die UI kennzeichnet dies ausdruecklich. Die bestehende Vorschau und
auswaehlbare Uebernahme der uebrigen Reihenattribute bleibt bestehen; deren Aenderungen
an veroeffentlichten Events werden auch auf aufloesbare Steuern geprueft.
Die Reihe zeigt **Automatisch je Event-Venue**, keinen pauschalen Satz fuer alle Orte.

## Buchung und Rundung

Eventpreise sind Brutto-Endkundenpreise. Die finale Berechnung erfolgt in der
bestehenden serialisierbaren Buchungstransaktion, nach der Gutscheinberechnung.
Entscheidung des Auftraggebers: **Auch Wertgutscheine reduzieren im Pilot die
Steuerbasis**, wie Rabattgutscheine. Guthabenreservierung und -journal behalten ihren
bestehenden Ablauf. Es erfolgt keine zusaetzliche Versteuerung des Gutscheinanteils.
Diese Pilotentscheidung bildet keine automatische steuerliche Klassifizierung von
Einzweck-/Mehrzweckgutscheinen ab.

`grossMinor = BookingPrice.payableAmountMinor`
`taxMinor = roundHalfUp(grossMinor * r / (100 + r))`
`taxNetMinor = grossMinor - taxMinor`

Die Rechnung verwendet Prisma.Decimal und ROUND_HALF_UP genau einmal auf die gesamte
Buchung in Cent. Sie verwendet keine Float-Geldarithmetik und keine Rundung pro Ticket.
Bei 0 Prozent ist Steuer = 0; bei Zahlbetrag 0 sind Brutto, Steuer und Netto = 0.
Auch manuelle kostenlose Buchungen erhalten einen konsistenten Snapshot.

BookingPrice speichert taxCountryCode, taxRate, taxGrossMinor, taxMinor, taxNetMinor,
taxSource und taxCalculationVersion=1. Die bestehenden SQL-Trigger schuetzen alle
Spalten gegen UPDATE/DELETE/TRUNCATE. Die neuen Felder sind nullable fuer alte
Snapshots; es gibt weder Backfill noch historische Neuberechnung.

## Stripe Direct Charges

Der bereits rabattierte/verrechnete Restbetrag ist eine einzige Checkout-Position
mit Menge 1. Dadurch stimmen Rundungsbasis, Gesamtbetrag und Steuer mit dem
Buchungssnapshot ueberein, auch wenn ein Rabatt nicht durch die Ticketzahl teilbar ist.

Neue Payment-Requests starten mit metadata.pilotTaxStatus=pending. Ausserhalb jeder
DB-Transaktion wird anhand des unveraenderlichen BookingPrice eine inklusive manuelle
Stripe-TaxRate im Kontext von Payment.stripeAccountId ermittelt. Der Cache
StripeTaxRateCache ist nach Connected Account, Land, Decimal-Satz und Anzeigename
(MwSt.) eindeutig. Eine deterministische Stripe-Idempotency-ID und die Suche nach
einem Metadaten-Schluessel erlauben Wiederverwendung auch nach Ablauf des
Stripe-Idempotency-Caches. 0 Prozent wird als explizite TaxRate mit percentage=0 gesendet;
kein truthy-Test und kein steuerloser Ersatzrequest.

Vor dem ersten Checkout-Aufruf friert ein Compare-and-swap den vollstaendigen Request
mit line_items[].tax_rates, price_data.tax_behavior=inclusive und Status frozen ein.
Retry und Reconciliation lesen diesen gespeicherten Request. Aenderungen an Regeln,
Venue, Event oder Reihe bauen keinen laufenden Checkout mit anderen Steuern neu auf.
Legacy-Payments ohne Pilotmarker bleiben unveraendert. Bei TaxRate-/Stripe-Fehlern
startet kein Checkout ohne Steuersatz; bestehende Reservierungen und die bewahrten
Requests erlauben den vorhandenen Retry. Keine sensiblen Stripe-Fehler werden im
Buchungsformular ausgegeben.

Stripe-API-Referenzen:
- https://docs.stripe.com/api/tax_rates/create
- https://docs.stripe.com/tax/tax-rates

Keine Stripe-Tax-Automatik, Registrierung, Produkttaxcodes oder Reverse-Charge-Logik.
Die Darstellung einer 0%-Zeile auf Stripe-Belegen haengt von Stripe ab. Der Request
enthaelt den expliziten Satz. Ein echter Sandbox-Checkout einschliesslich des Belegs
wurde in dieser Implementierung nicht ausgefuehrt.

## Umsatz und historische Buchungen

Die bestehende Karten-Bruttosumme und die kalkulatorischen Stripe-Gebuehren bleiben
unveraendert. Admins sehen die Summe gespeicherter Steuerbetraege; unterschiedliche
Saetze werden einzeln aufgefuehrt. Sobald eine beruecksichtigte historische Buchung
keinen Snapshot hat, sind Steuer-/Nettogesamtsumme unbekannt. Das Venue-Land liefert
keinen Ersatzsatz. Teilrueckerstattungen bleiben wie bisher ausgeschlossen, solange
lokal kein verlaesslicher Restbetrag vorliegt.

## Deployment

Migration: `prisma/migrations/20261111120000_company_country_taxes/migration.sql`.
Schema, Migration und Anwendung gemeinsam ausrollen. Im freigegebenen Deployment:

```sh
npx prisma migrate deploy
npm run db:generate
```

Die Migration wurde nicht angewendet. Kein `migrate dev` oder `db push` gegen Produktion.
Vor Freigabe bezahlter Events die Benoetigten Laenderregeln und Venue-Laender pflegen;
vorhandene veroeffentlichte Events erhalten keinen automatischen Ersatzsatz.

## Gezielte Pruefungen

- tests/taxes.test.ts: ISO, Validierung, Vererbung, Null/0, Company-Grenzen, Cent-Rundung.
- tests/tax-authorization.test.ts: Admin-Checks, Company-Scoping, Company-User-Datenschutz.
- tests/tax-checkout.test.ts: Direct Account, inklusive TaxRate, 0%, Cache, Freeze, Fehler.
- tests/event-revenue.test.ts: historische unbekannte Steuer, gemischte Snapshots, UI.
- tests/voucher-reservations.test.ts: bestehende Reservierungs-/Replay-Logik mit Steuern.

Stripe-Steuertotal und Gesamtbetrag werden vor Rueckgabe einer neuen oder wieder
geladenen Session sowie bei Fulfillment gegen den gespeicherten Request geprueft.
Abweichungen stoppen den Ablauf mit einer datenfreien Diagnose fuer Reconciliation.

Kein Build, Lint, Typecheck oder vollstaendiger Testlauf; keine Datenbankmigration.

## Geaenderte Implementierungsdateien

- `app/(public)/events/[companySlug]/[eventId]/actions.ts`
- `app/company/[companyKey]/event-series/[seriesId]/page.tsx`
- `app/company/[companyKey]/event-series/_components/series-table.tsx`
- `app/company/[companyKey]/event-series/actions.ts`
- `app/company/[companyKey]/events/[eventId]/bookings/_components/bookings-table.tsx`
- `app/company/[companyKey]/events/[eventId]/bookings/_components/event-revenue.tsx`
- `app/company/[companyKey]/events/[eventId]/bookings/actions.ts`
- `app/company/[companyKey]/events/[eventId]/page.tsx`
- `app/company/[companyKey]/events/_components/events-table.tsx`
- `app/company/[companyKey]/events/actions.ts`
- `app/company/[companyKey]/settings/page.tsx`
- `components/tax-configuration-form.tsx`
- `components/tax-configuration.tsx`
- `components/tax-override-fields.tsx`
- `docs/events-and-series.md`
- `docs/stripe.md`
- `docs/taxes.md`
- `docs/vouchers.md`
- `lib/bookings/management.ts`
- `lib/bookings/revenue.ts`
- `lib/bookings/validation.ts`
- `lib/event-series/update.ts`
- `lib/events/event-mutations.ts`
- `lib/payments/checkout.ts`
- `lib/payments/fulfillment.ts`
- `lib/payments/tax-rates.ts`
- `lib/taxes/actions.ts`
- `lib/taxes/countries.ts`
- `lib/taxes/service.ts`
- `lib/venues/validation.ts`
- `lib/vouchers/service.ts`
- `prisma/migrations/20261111120000_company_country_taxes/migration.sql`
- `prisma/schema.prisma`
- `tests/event-revenue.test.ts`
- `tests/tax-authorization.test.ts`
- `tests/tax-checkout.test.ts`
- `tests/taxes.test.ts`
- `tests/voucher-reservations.test.ts`
