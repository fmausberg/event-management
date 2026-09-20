# Event- und Ticketkapazitätsverwaltung

Next.js App Router, TypeScript, Prisma 7 und PostgreSQL. Phase 1 stellt die zentrale
Datenhaltung und Integrationsverträge bereit. Externe APIs sind noch nicht angebunden.

## Lokal starten

```bash
npm install
npm run dev
```

`DATABASE_URL` muss auf die gewünschte PostgreSQL-Datenbank zeigen. Secrets gehören
in die lokale, von Git ignorierte `.env` oder `.env.local`, nicht in den Quellcode.
Für die Prisma-CLI gilt: Shell-Variable vor `.env.local` vor `.env`. Die URL und ihre
TLS-Parameter werden unverändert verwendet. Next.js lädt seine Umgebungsvariablen
selbst; verwende für CLI und Anwendung dieselbe Datenbankkonfiguration.

`npm run dev` und `npm run build` generieren den Prisma-Client automatisch.
`npm run db:generate` generiert ihn separat. Keine dieser Aktionen migriert eine DB.

## Ausstehende Migration

Das neue Schema wurde noch nicht auf eine Datenbank angewendet. Prüfe zuerst, dass
die effektive `DATABASE_URL` eine lokale Entwicklungsdatenbank bezeichnet. Danach
kannst du selbst ausführen:

```bash
npx prisma migrate dev --name central_event_capacity
npm run db:generate
```

Der Migrationsbefehl verwendet die `datasource.url` aus `prisma.config.ts` und damit
die oben beschriebene Umgebungsvariable. **Nicht gegen eine Produktions- oder
Remote-Datenbank ausführen.** Prisma Migrate benötigt außerdem eine lokale
Shadow-Datenbank bzw. die Berechtigung, diese anzulegen.

`beginsAt` und `endsAt` sind über `@map("Begin")` / `@map("End")` mit den bestehenden
Spalten verbunden. Dadurch bleiben vorhandene Datumswerte erhalten. Die physische
Umbenennung dieser Spalten ist nicht notwendig. `Event.id` bleibt kompatibel mit
der vorhandenen TEXT-Spalte; neue Buchungs- und Mapping-IDs sind PostgreSQL-UUIDs.
Die Default-Werte für Event-Zeitstempel ermöglichen das Ergänzen bestehender Zeilen;
deren `createdAt` entspricht dann dem Migrationszeitpunkt, nicht dem ursprünglichen
Erstellungszeitpunkt.

## Datenmodell und Business-Logik

- `Event`: Stammdaten, maximale Kapazität, Zeitstempel und Relationen.
- `PlatformEvent`: Zuordnung zu einer Plattform und externen Event-ID. Der Schlüssel
  `(platform, externalEventId)` ist global eindeutig: Ein externes Event gehört
  genau einem zentralen Event. Mehrere unterschiedliche externe IDs derselben
  Plattform können demselben zentralen Event zugeordnet werden.
- `Booking`: Externe Buchung mit positiver ganzzahliger Menge und Status
  `CONFIRMED` oder `CANCELLED`. `(platform, externalBookingId)` verhindert Duplikate.
- Indizes auf `(eventId, status)` bzw. `(eventId, syncStatus)` unterstützen Abfragen.
  Relationen verwenden `Restrict`, um Buchungshistorie nicht versehentlich zu löschen.

`getEventCapacity(eventId)` summiert ausschließlich bestätigte Buchungen.
`remainingSeats = Math.max(0, maxSeats - confirmedSeats)`. Überbuchungen bleiben in
`confirmedSeats` sichtbar; freie Plätze werden nie negativ. Es gibt keine redundant
gespeicherte Restkapazität. Fehlende Events führen zu einem Fehler, nicht zu
scheinbar null freien Plätzen.

`upsertExternalBooking(input)` validiert Menge, IDs, Datum, Plattform und Status und
verwendet einen transaktionalen Upsert. Wiederholte Importe aktualisieren dieselbe
Buchung. Stornierung und erneute Bestätigung verändern deren Kapazitätsbeitrag.
Die nachträgliche Zuordnung einer bestehenden Buchung zu einem anderen Event wird
abgelehnt und die Transaktion zurückgerollt. Der Import führt keinen externen Sync aus.

`/events` ist eine Server Component. Sie lädt Events und aggregierte Buchungen beim
Seitenaufruf mit einem konsistenten DB-Snapshot und zeigt einen Empty State bei
leerer Datenbank. Die Seite benötigt das migrierte Schema; der Build benötigt keine
erreichbare Datenbank. Zeiten werden in `Europe/Berlin` angezeigt.

## Integrationen und Synchronisierung

`lib/integrations/types.ts` enthält plattformunabhängige Domain-Typen ohne
Prisma-Abhängigkeit. `PlatformAdapter` definiert `getBookings` und
`updateAvailability`; `registry.ts` ordnet Plattformen ihren Adaptern zu.
Neue Adapter werden dort registriert, ohne die Business-Logik anzupassen.

Eventbrite und Rausgegangen enthalten nur ausdrücklich gekennzeichnete Platzhalter.
Die Client-Factories und Adapter-Operationen werfen `Not implemented`, ohne HTTP
aufzurufen. Anbieter-Payloads werden erst nach Prüfung der offiziellen Verträge
ergänzt. `POST /api/webhooks/eventbrite` antwortet mit HTTP 501 und verarbeitet keine
Daten.

`syncEventCapacity(eventId)` wird nur ausdrücklich aufgerufen:

1. Kapazität berechnen und `ACTIVE`-Zuordnungen laden.
2. Adapter über die Registry auswählen und Verfügbarkeit übertragen.
3. Bei Erfolg `lastSyncedAt` setzen und `lastError` löschen.
4. Bei Fehler `lastError` speichern und mit der nächsten Zuordnung fortfahren.

Die Funktion liefert Kapazität und Einzelresultate zurück. Auch Fehler beim
Speichern eines Plattformfehlers brechen die Schleife nicht ab; sie erscheinen als
`errorPersistenceFailed`. Beliebige SDK-Fehlermeldungen werden nicht gespeichert,
da sie Secrets oder Payloads enthalten können. Bekannte Platzhalter- und
Registry-Fehler erhalten verständliche Meldungen, andere Fehler eine neutrale Meldung.

Fehlgeschlagene aktive Zuordnungen bleiben `ACTIVE`, damit ein späterer expliziter
Aufruf erneut versuchen kann. `DISABLED` und `ERROR` werden übersprungen, bis die
Zuordnung bewusst wieder aktiviert wird. Normale Seitenaufrufe synchronisieren nicht.

## Prüfungen und offene Arbeiten

```bash
npm test
npm run lint
npm run build
```

Die Tests prüfen Business-Verhalten mit Datenbank-Doubles: Kapazität, Idempotenz,
Stornierung, Event-Zuordnung, Eingabevalidierung, Sync-Fehlerisolation, Registry,
Webhook und Client-Singleton. Echte PostgreSQL-Constraints und parallele Upserts
benötigen nach Freigabe der Migration zusätzliche Integrationstests.

Offen für spätere Phasen:

- Migration durch den Betreiber und Laufzeittest gegen eine lokale Datenbank.
- Verifizierte Anbieter-APIs, DTOs, Authentifizierung und Webhook-Prüfung.
- Reihenfolge/Versionierung externer Änderungen gegen verspätete Buchungs-Updates.
- Serialisierung von Sync-Aufrufen pro Event, Wiederholungen und Behandlung von
  Änderungen während eines laufenden Syncs. Phase 1 liefert einen Snapshot;
  überlappende Aufrufe müssen vom künftigen Aufrufer verhindert werden.
- Verteilte Buchungen können gleichzeitig eintreffen und überbuchen. Die aktuelle
  Kapazitätsberechnung ist keine plattformübergreifende Reservierungsgarantie.

Es gibt keine Cronjobs, Queue, automatische Drittanbieter-Event-Erstellung oder
Kunden-, Zahlungs- und Ticket-PDF-Verarbeitung.
