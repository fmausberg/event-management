# Stornierungen und Erstattungen

## Konfiguration und Migration

Migration: `prisma/migrations/20261027120000_cancellation_requests/migration.sql`.
Sie ergänzt nullable Minutenfelder an Event und EventSeries, CancellationRequest,
CancellationMail und Status-Enums. Bestehende Termine erhalten `NULL`; Buchungen,
Tickets und Zahlungen werden nicht verändert. Keine Gebühren oder Teilrückerstattungen.

Nach Prüfung der Ziel-Datenbank und der ausstehenden Migrationen:

```sh
npx prisma migrate deploy
npm run db:generate
```

Die Migration wird nicht durch einen Build angewendet. Der partielle Unique-Index
`CancellationRequest_one_active_per_booking` ist bewusst im SQL definiert:
höchstens eine PENDING- oder APPROVED-Anfrage pro Buchung. Er darf bei späteren
Schemaänderungen nicht entfernt werden. Zurückgezogene und abgelehnte Anfragen
bleiben erhalten und erlauben eine neue Anfrage. PostgreSQL prüft außerdem die
nicht negativen Fristwerte. Der Prisma-Client bleibt auf Version 7.

## Frist und Bedienung

Die Formulare zeigen Stunden/Tage; gespeichert werden ganze Minuten (0 zulässig,
leeres Feld = NULL/deaktiviert). Der Serienwert wird bei Auswahl einer Reihe in
das Eventformular kopiert. Das Event hat anschließend seinen eigenen Wert; Spätere Änderungen
der Reihe können über die [Serienvorschau](events-and-series.md) für ausgewählte
zukünftige Events übernommen werden; ohne Auswahl bleiben Eventwerte erhalten. Auch die ältere Admin-Eventmaske
zeigt und speichert den Eventwert.

Die kostenfreie Grenze ist `beginsAt - Minuten`. Verglichen werden absolute UTC-
Zeitpunkte serverseitig innerhalb der Transaktion, inklusive der exakten Grenze.
Am oder nach dem Eventbeginn sind neue Stornierungen und Genehmigungen ausgeschlossen.
Bei NULL oder fehlendem Beginn ist nur eine Anfrage möglich. Eine offene Anfrage
kann weiterhin abgelehnt oder vom Eigentümer zurückgezogen werden.

Unter `/account/bookings` stehen pro Buchung Status, Frist, Verlauf und Aktionen.
`/account` und „Meine Veranstaltungen“ verlinken darauf. Die öffentliche Eventseite
zeigt die Regel vor der Buchung. Die Zahlungsrückkehrseite zeigt eine stornierte
Buchung auch während einer noch ausstehenden Erstattung korrekt an.

`/company/[companyKey]/cancellations` zeigt offene Anfragen sowie Historie und
Erstattungen. Aktive COMPANY_ADMINs und COMPANY_USER der jeweiligen Company sowie globale ADMINs
dürfen entscheiden/wiederaufnehmen; alle Aktionen prüfen die aktuelle DB-Berechtigung.
Interne Notizen werden nicht an Kunden weitergegeben. Kunden können ausschließlich
ihre über `Booking.userId` verknüpften Buchungen verwalten. Gastbuchungen werden
nicht anhand einer unbestätigten E-Mail-Adresse einem Konto zugeordnet; ein neuer
Gast-Token-/Kontoverknüpfungsablauf ist nicht Teil dieser Änderung.

## Zustände und Transaktionen

Eine PENDING-Anfrage verändert keine Buchung, Tickets oder Zahlungen. REJECTED und
WITHDRAWN ebenfalls nicht. Entscheidung, Entscheider und Zeitpunkt werden gespeichert.
Kostenfreie Selbststornierungen erzeugen direkt eine APPROVED-Anfrage mit
`automatic=true` und dem Kunden als Akteur.

Bei APPROVED werden Buchung und alle Tickets atomar CANCELLED. Dadurch werden auch
die Plätze über die vorhandene Kapazitätsberechnung freigegeben. Eine Onlinezahlung
bleibt PAID, solange Stripe keinen Erfolg bestätigt. Die Erstattungsverarbeitung
ist ein separater, dauerhafter Auftrag an der Anfrage:

| Refund-Status | Bedeutung |
| --- | --- |
| NONE | Keine Onlinezahlung vorhanden; keine Stripe-Erstattung |
| PENDING | Noch nicht angefordert, unklarer Netzwerk-Ausgang oder Stripe verarbeitet |
| SUCCEEDED | Stripe hat die vollständige Erstattung bestätigt; Payment ist REFUNDED |
| FAILED | Stripe meldet definitiv failed/canceled; berechtigte Company-Mitglieder und globale Administratoren dürfen erneut anstoßen |
| REVIEW | Unklarer alter Versuch oder konkurrierende/externe Erstattung; Stripe prüfen |

Bestätigte Buchungen ohne Payment gelten im bestehenden Modell als abgeschlossen
(kostenlose oder manuell bestätigte Buchungen). Es wird kein fiktiver Zahlungsdatensatz
angelegt. Eventuelle außerhalb von Stripe erfolgte Zahlungen müssen außerhalb dieser
Integration zurückgegeben werden. Unbezahlte, abgelaufene, bereits stornierte und
teilweise erstattete Onlinebuchungen können diesen Ablauf nicht neu starten.

Serializable-Transaktionen, bedingte Statusänderungen und der partielle Unique-Index
schützen gegen konkurrierende Anfragen/Entscheidungen. Serialisierungsfehler werden
begrenzt wiederholt. Bestehende Buchungsbearbeitung und Plattformimporte dürfen
aktive Stornierungsprozesse nicht überschreiben; Löschen mit Historie ist gesperrt.

## Stripe und Wiederaufnahme

Alle Stripe-Aufrufe verwenden das am Payment gespeicherte Connected Account.
Die vollständige Zahlungssumme kommt ausschließlich aus Payment. Netzwerkaufrufe
laufen außerhalb der DB-Transaktionen. Ein fünfminütiger Lease verhindert parallele
Worker, und der Schlüssel `cancellation-<requestId>-<attempt>` verhindert doppelte
Stripe-Operationen. Nach unbekannten Fehlern bleibt derselbe Versuch aktiv.

Vor Erstellung wird die gesamte paginierte Refund-Liste nach dem gespeicherten
Versuch durchsucht. So wird auch eine nach dem Stripe-Aufruf verlorene Antwort
wiedergefunden. Nach 23 Stunden wird ein unbekannter Versuch nicht erneut erstellt,
weil Stripe Idempotenzschlüssel nach 24 Stunden entfernen kann: REVIEW erfordert
Prüfung im Stripe-Dashboard. Die UI-Aktion für REVIEW liest nur erneut; sie setzt
keinen neuen Schlüssel. Eine manuell im Dashboard vollendete Erstattung wird per
Webhook abgeglichen. Neue Versuche sind nur nach einem definitiven FAILED erlaubt.

Für den bestehenden Connect-Webhook müssen zusätzlich diese Events aktiviert sein:

- `refund.created`
- `refund.updated`
- `refund.failed`
- weiterhin `charge.refunded` und die vorhandenen Checkout-Events

Webhooks laden den aktuellen Stripe-Zustand statt einem alten Event-Snapshot zu
vertrauen. `charge.amount_refunded` kann noch ausstehende Erstattungen enthalten:
die Anwendung summiert deshalb ausschließlich `succeeded`-Refunds, bevor sie den
Payment-Status ändert. Wiederholte oder ältere Events dürfen Erfolg nicht zurücksetzen.
Kontenzuordnung, PaymentIntent, Währung und Betrag werden geprüft.

Der vorhandene geschützte `POST /api/payments/reconcile` verarbeitet nun zusätzlich
ausstehende Erstattungen und Stornierungs-E-Mails in Batches von 50. Er muss regelmäßig
(z. B. jede Minute) mit `Authorization: Bearer <PAYMENTS_CRON_SECRET>` aufgerufen werden.
Ohne Scheduler sind Webhooks und die administrative Wiederaufnahme weiterhin aktiv,
aber Netzwerk- und Mailfehler werden nicht verlässlich automatisch nachgeholt.

## E-Mail und Betrieb

Die transaktionale Outbox nutzt dieselbe Verschlüsselung mit AUTH_SECRET und denselben
SMTP-Versand samt Footer wie die bestehenden Ticketmails. Anfrage-Eingänge gehen an
aktive, mit einem User verknüpfte Company-Administratoren. Entscheidungen gehen an
den Kunden; Erstattungsfehler zusätzlich an die Company-Administratoren. Fehlen diese,
wird das mit Request-ID protokolliert; die Anfrage bleibt in der Company-Übersicht.

Nach dem Commit wird der Versand versucht, weitere Versuche übernimmt der Scheduler.
SMTP-Fehler ändern weder Entscheidung noch Zahlungszustand. Erfolgreich verschickte
Inhalte werden gelöscht; ID/sentAt bleiben zur Deduplizierung. SMTP bietet kein
Exactly-once: Bei einem Prozessabbruch nach Versand, aber vor Speicherung von sentAt,
kann eine Benachrichtigung doppelt eintreffen. Entscheidungen/Erstattungen werden
dadurch nicht wiederholt. Logs enthalten nur Vorgangs-/Mail-/Webhook-IDs, keine
Zahlungsgeheimnisse oder vollständigen Stripe-Fehlerobjekte.

## Prüfung

Stripe-Referenzen: [Refunds](https://docs.stripe.com/refunds),
[Refund-Erstellung](https://docs.stripe.com/api/refunds/create),
[Idempotenz und Aufbewahrungsfrist](https://docs.stripe.com/api/idempotent_requests).

`npm test`, `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`, `npm run build`.
Die neuen Tests decken Grenzzeitpunkte, UTC/DST, fehlenden Beginn, Authentifizierung,
Company-Rollen, Wiederholungen, konkurrierende Statusänderungen, Ablehnung/Rückzug,
Online- und Offlinegenehmigung, Erfolg/pending/Fehler von Stripe, verlorene Antworten,
Idempotenzfenster, Connected-Account-Prüfung und SMTP-Wiederaufnahme ab.

Stripe und Datenbankzugriffe werden in Unit-Tests gemockt. Vor Live-Freischaltung
Migration und Connect-Webhooks in einer Testumgebung prüfen, einschließlich einer
echten Rückerstattung und zweier paralleler Requests gegen PostgreSQL. Der tatsächliche Prüf- und Migrationsstand ist je Umgebung zu ermitteln;
diese Anleitung dokumentiert keinen erfolgreichen Livebetrieb.
