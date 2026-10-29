# Kapazität und externe Eventplattformen

## Datenmodell

- `Event`: Company, Veranstaltungsdaten, Kapazität und Beziehungen.
- `PlatformEvent`: Zuordnung eines zentralen Events zu Plattform und externer
  Event-ID. `(platform, externalEventId)` ist global eindeutig.
- `Booking`: interne, öffentliche oder externe Buchung. Bei externen Buchungen
  verhindert `(platform, externalBookingId)` doppelte Importe.
- Buchungsstatus und zugehörige Zahlungen/Tickets sind getrennte Daten.
  Die vollständigen Felder und Constraints stehen in `prisma/schema.prisma`.

`getEventCapacity(eventId)` liest Event und Buchungsaggregation in einem
Repeatable-Read-Snapshot. Es berücksichtigt CONFIRMED **und PENDING_PAYMENT**.
Das Feld `confirmedSeats` des Rückgabemodells enthält damit auch reservierte
Plätze aus noch offenen Zahlungen. `remainingSeats` wird als
`Math.max(0, maxSeats - confirmedSeats)` berechnet; unbekannte Kapazität wird
in diesem Helfer als null freie Plätze behandelt. Fehlende Events führen zu
einem Fehler.

Eine Berechnung allein reserviert keine Plätze auf anderen Plattformen.
Öffentliche Buchungen und manuelle Buchungsaktionen prüfen ihre Kapazität
jeweils im eigenen Transaktionsablauf; siehe [Buchungsverwaltung](booking-management.md)
und [Stripe](stripe.md).

## Externe Buchungsimporte

`lib/bookings/upsert-external-booking.ts` validiert den Import und verwendet
einen transaktionalen Upsert. Wiederholte Importe aktualisieren dieselbe Buchung.
Die nachträgliche Zuordnung einer bestehenden externen Buchung zu einem anderen
Event wird abgewiesen. Aktive Stornierungsprozesse dürfen nicht überschrieben
werden. Ein Import führt nicht selbst einen externen Verfügbarkeits-Sync aus.

## Adapter und explizite Synchronisierung

`lib/integrations/types.ts` enthält plattformunabhängige Typen.
`PlatformAdapter` definiert `getBookings` und `updateAvailability`;
`registry.ts` ordnet Plattformen ihren Adaptern zu.

Eventbrite und Rausgegangen sind Platzhalter: Client-Factories und
Adapteroperationen werfen `Not implemented`, ohne externe HTTP-Aufrufe.
`POST /api/webhooks/eventbrite` antwortet mit HTTP 501.

`syncEventCapacity(eventId)` wird ausdrücklich aufgerufen:

1. Kapazität berechnen und ACTIVE-Plattformzuordnungen laden.
2. Adapter auswählen und Verfügbarkeit übertragen.
3. Bei Erfolg lastSyncedAt setzen und lastError löschen.
4. Bei Fehler einen bereinigten Fehler speichern und mit der nächsten Zuordnung
   fortfahren. Fehler beim Speichern erscheinen als errorPersistenceFailed.

Fehlgeschlagene aktive Zuordnungen bleiben ACTIVE; DISABLED und ERROR werden
übersprungen. Normale Seitenaufrufe synchronisieren nicht.

## Grenzen

Es gibt keinen automatischen Scheduler für externe Eventplattformen und keine
automatische Drittanbieter-Eventerstellung. Vor echter Anbindung fehlen geprüfte
Anbieterverträge, Authentifizierung und Webhook-Verarbeitung.
Versionierung externer Updates und Serialisierung überlappender Sync-Aufrufe
müssen bei der Integration ergänzt werden. Verteilte Buchungen können gleichzeitig
eintreffen; die lokale Berechnung garantiert keine plattformübergreifende Reservierung.

Stripe ist unabhängig von diesen Platzhaltern bereits implementiert.
Der Zahlungs-/Mail-Scheduler ist in [Stripe](stripe.md) und
[Ticket-Outbox](ticket-outbox.md) beschrieben.
