# Audit-Pilot: Veranstaltungsreihen

## Aufbau und Umfang

`lib/db/prisma.ts` erzeugt weiterhin genau einen verzögerten Prisma-7.10-Client
mit `@prisma/adapter-pg`. Der exportierte Client wird durch die zentrale Fassade
in `lib/audit/client.ts` geschützt. Kein `$use`, keine privaten Prisma-APIs und
kein Auth.js-Aufruf aus der Datenbankschicht. Es werden ausschließlich Änderungen
an `EventSeries` gespeichert, niemals Änderungen an `Event` oder anderen Modellen.

Die tatsächliche Detailroute ist
`/company/[companyKey]/event-series/[seriesId]`. Die serverseitige Historienabfrage
prüft unabhängig `requireCompanyAccess(companySlug)` und anschließend die
Company-Zugehörigkeit der Reihe. Das entspricht der übrigen Detailseite:
aktive COMPANY_USER und COMPANY_ADMIN der Company sowie Plattform-ADMIN.
Die Historie wird am Ende der Veranstaltungstabelle in Grau mit 20 Einträgen
pro Seite als Tabelle (Timestamp, Wer?, Was?, Details) angezeigt. Die aktuelle
Nutzer-E-Mail wird nach Autorisierung über die gespeicherte Akteur-ID nachgeladen,
aber nicht ins Audit kopiert. Bei gelöschten Nutzern bleibt die ID als Ersatz.
Details zeigen freigegebene Vorher-/Nachherwerte als JSON. E-Mail-Änderungen werden
damit nicht historisiert; die Anzeige verwendet immer die aktuelle Adresse.
Gelöschte Reihen behalten ihre Audit-Einträge, haben aber keine Detailseite mehr.
Keine rückwirkende Historie und keine automatische Bereinigung.
Aufbewahrung und spätere kontrollierte Löschung sind fachlich noch festzulegen.

## Explizite Feldpolitik

Gespeicherte Werte: `number`, `name` (Titel der Reihe), `shortdescription`, `description`, `companyId`, `createdById`,
`suggestedVenueId`, `suggestedTrainerId`,
`suggestedFreeCancellationUntilMinutesBeforeStart`, `suggestedDuration`,
`suggestedMaxSeats`, `suggestedTicketPrice`, `suggestedCurrency`.
Decimal-Preise werden als Strings mit zwei Nachkommastellen gespeichert.

Auf ausdrücklichen Wunsch wird die Kurzbeschreibung ab Policy-Version 2 mit
Vorher-/Nachherwerten gespeichert. Ältere Kurzbeschreibungsmarker lassen sich
nicht rückwirkend mit Werten ergänzen. Ab Policy-Version 3 wird auf ausdrücklichen
Wunsch auch `description` mit Vorher-/Nachherwerten gespeichert (sanitisiertes HTML
wie im fachlichen Datensatz, Anzeige ausschließlich als escapeter JSON-Text).
Alte Beschreibungsmarker bleiben unverändert. Die Freigabe gilt ausdrücklich für
diese beiden Inhaltsfelder; andere sensible Felder bleiben ausgeschlossen.

`imageUrl` und der veraltete
`suggestedTrainerName` erhalten bei Änderungen ausschließlich Feldnamen in
`redactedFields`. Ihre Werte werden zum Vergleich transient gelesen, aber nie
in Audit-Payloads oder Fehlertexte übernommen. Diese Marker sind notwendig,
damit eine reine Beschreibungs-/Bildänderung als Änderung sichtbar bleibt.
Bei Create/Delete werden nur die freigegebenen Werte gespeichert, keine Marker.
`createdAt` und `updatedAt` sind ausgeschlossen. Technische Timestamp-Updates
oder identische Werte erzeugen keinen UPDATE-Eintrag. Neue Schemafelder sind
automatisch ausgeschlossen und benötigen eine ausdrückliche Policy-Entscheidung.
Keine Passwort-, Token-, Kontakt-, Mail-, Zahlungs- oder Fehler-Payloads.
IDs sind weiterhin personenbezogen zu behandeln; auch ein Veranstaltungstitel
ist kein geeigneter Ort für personenbezogene Kontaktdaten.

## Operationen und Atomarität

Direktes `create`, `update`, `delete`, `createMany`, `updateMany`, `deleteMany`,
`createManyAndReturn`, `updateManyAndReturn` und `upsert` werden unterstützt.
Pro tatsächlich angelegter, geänderter oder gelöschter Reihe entsteht ein Eintrag;
bei `skipDuplicates` keine Einträge für übersprungene Zeilen. Die ursprünglichen
Argumente, fachlichen WHERE-Bedingungen und Rückgabeformen bleiben erhalten.
UPSERT wird anhand des persistierten Zustands als CREATE oder UPDATE erfasst.

Die Fassade öffnet für diese Writes außerhalb einer Transaktion eine kurze
interaktive Transaktion. Innerhalb bestehender Callback-Transaktionen laufen
Vorherzustand, Mutation, Nachherzustand und Audit-Insert auf deren ursprünglichem
`tx`. Transaktionsoptionen (einschließlich Isolation und Timeout) bleiben erhalten.
Auch ein globaler Clientzugriff innerhalb desselben asynchronen Callbacks wird
an dessen `tx` gebunden. Gleichzeitige Writes innerhalb einer Transaktion werden
serialisiert. Ein abgefangener Schreib-/Auditfehler markiert die Transaktion als
fehlgeschlagen: sie darf danach nicht mit unvollständiger Historie committen.
Es gibt keine neuen automatischen Retries und keine externen Nebenwirkungen
innerhalb des Audit-Executors. Bestehende fachliche Retry-Schleifen bleiben bestehen.

**Bewusster Pilot-Kompromiss:** Für eine korrekte Behandlung beliebiger Bulk-WHEREs,
UPSERT, `select`/`include` und Kaskaden sperrt der Executor `EventSeries` mit
`SHARE ROW EXCLUSIVE` und liest vor/nach der Mutation alle Reihen mit einer
expliziten Feldprojektion. Das verhindert konkurrierende Schreibänderungen
während des Vergleichs, ohne gewöhnliche Leser zu blockieren. Kosten: zwei
Tabellenscans pro Write, serialisierte Schreibzugriffe und eine bis zum Commit
gehaltene Sperre. Lange bestehende Transaktionen können Sperrwartezeiten und
Deadlocks erzeugen. Kein stiller Audit-Verlust bei Deadlocks: der Vorgang scheitert.
Vor einer Ausweitung auf große Datenmengen: gezielte Zeilensnapshots/Sperrstrategie
entwickeln und mit echtem PostgreSQL prüfen. Die Policy ist zentral registriert;
für weitere Modelle mit `id` und `companyId` kann derselbe Snapshot-/Sperr-Executor
verwendet werden. Zusätzlich müssen Feldlisten, mögliche indirekte Writes
(`affectedBy`), Relationskaskaden und Historienberechtigungen geprüft werden.
Andere/zusammengesetzte Schlüssel benötigen eine Erweiterung des Executors.
Keine Audit-Inserts in Fachservices.

## Verschachtelte Writes, Kaskaden und Raw-SQL

Verschachtelte Schreibzugriffe auf EventSeries werden auch unter nicht auditierten
Eltern über öffentliche `Prisma.dmmf`-Relationsmetadaten vor der Mutation erkannt
und abgewiesen, einschließlich `connect`, `set`, `connectOrCreate` und `upsert`.
Direkte EventSeries-Writes dürfen Relationsoperationen an nicht auditierten
Modellen ausführen, soweit darin keine verbotenen weiteren Writes liegen.

Das Schema hat keine eingehende ON DELETE CASCADE-Löschung von EventSeries.
Company, Ersteller und vorgeschlagener Ort sind RESTRICT. Ein direktes
Trainer-`delete`/`deleteMany` kann `suggestedTrainerId` auf NULL setzen; diese
EventSeries-Änderungen werden im selben Executor automatisch als UPDATE erfasst
(Operation `Trainer.delete` bzw. `Trainer.deleteMany`). Trainer selbst bekommt
keine Historie. Verschachtelte Trainerlöschungen werden abgewiesen.
Primärschlüsseländerungen von EventSeries, Company, User, Venue und Trainer
werden wegen möglicher ON UPDATE-Kaskaden abgewiesen, auch in nested Updates.
Ein Company-Wechsel bestehender Reihen ist nicht unterstützt, damit bisherige
Historie nicht mandantenübergreifend offengelegt wird.

`$transaction([...])` ist ausdrücklich nicht unterstützt; bestehende Anwendungspfade
verwenden Callback-Transaktionen. Writes bleiben bis zum Await verzögert, sodass
eine abgewiesene Array-Transaktion keine Änderung vorab ausführt. Verschachtelte
`$transaction`-Aufrufe und öffentliches `$extends` werden ebenfalls abgewiesen.

Raw-SQL ist ausschließlich für die exakt geprüften vorhandenen Query-Templates
in `lib/audit/raw.ts` freigegeben (Healthcheck, Voucher-Zeilensperren,
Advisory-Lock, Review-Kandidatenabfrage). Werte bleiben gebundene Parameter.
Beliebige SELECTs sind nicht automatisch sicher: Funktionen könnten schreiben.
Andere SQL-Templates, schreibendes SQL und Unsafe-Methoden werden kontrolliert
abgewiesen. Neue Raw-Abfragen brauchen eine explizite Prüfung/Freigabe.

## Vertrauenswürdiger Akteurkontext

Die Series-Server-Actions holen serverseitig `auth()` und umschließen den Ablauf
mit `withAuditContext`. Nur die verifizierte Session liefert `actorUserId`.
Formularfelder und Datensatz-IDs sind keine Identitätsquelle. Die Fachautorisierung
bleibt zusätzlich in `requireCompanyAccess` bestehen.

`AsyncLocalStorage` isoliert Kontext und Transaktionsbindung zwischen Requests.
Die Stores werden pro Prozess über `globalThis` geteilt, damit Hot Reloads keine
getrennten Kontextinstanzen erzeugen. Nur der Basisclient/Pool wird global gecacht;
die Fassade mit ihrer Policy wird beim Neuladen neu aufgebaut. Der Akteurkontext
wird vor verzögerter Query-Ausführung bzw. vor Prisma-Transaktionscallbacks erfasst
und ausdrücklich weitergegeben. Bestehende UNKNOWN-Einträge werden nicht nachträglich
einem vermeintlichen Akteur zugeordnet.
Ohne Kontext gilt UNKNOWN / `unscoped-prisma`; dies ist kein behaupteter Systemjob.
Für nicht angemeldete Abläufe wird ANONYMOUS gesetzt. Authentifizierte Webhooks
oder Jobs müssen nach ihrer jeweiligen Authentizitätsprüfung zentral so starten:

```ts
return withAuditContext(
  { actorType: "SYSTEM", source: "verified-job-name" },
  () => runJob(),
);
```

Aktuell schreibt kein solcher Job EventSeries; deshalb werden keine unbeteiligten
Webhooks oder Jobs geändert. Pro umschlossenem Ablauf wird eine serverseitige UUID
als Korrelations-ID erzeugt. Unscoped Writes erhalten eine eigene UUID pro Write.
Zeitpunkte sind Erfassungszeitpunkte innerhalb der Transaktion, keine garantierten
Commit-Zeitpunkte. Ein Session-Claim protokolliert keine fremden Modelle.

## Schutz und Inbetriebnahme

Über den Anwendungsclient sind sämtliche AuditLog-Writes gesperrt, auch CREATE.
Nur der interne Executor schreibt über seinen nicht exportierten Basistransaktionsclient.
Es gibt keine Fremdschlüssel, die bei Benutzer-/Company-Löschung Audit-Zeilen
verändern oder entfernen. AuditLog wird selbst nie auditiert.

Es wurden auf Anweisung ausschließlich Schema und Anwendungscode geändert,
keine Migrationsdateien angelegt und keine Migration ausgeführt. Deshalb enthält
dieser Pilot **keinen Datenbank-Trigger und keine neuen Datenbankrechte**.
Der Schutz ist zunächst Anwendungsschutz: direkter SQL-Zugriff oder ein separat
erzeugter PrismaClient kann AuditLog weiterhin manipulieren. Bestehende
Voucher-History-Trigger ändern das für AuditLog nicht. Separat können später eine
INSERT/SELECT-Laufzeitrolle ohne Eigentümerrechte sowie UPDATE/DELETE/TRUNCATE-
Schutztrigger nach dem vorhandenen Journalmuster ergänzt werden. Privilegierte
Datenbankadministratoren können auch diesen Schutz verändern.

Vor Nutzung selbst eine Migration erzeugen (Entwicklungsdatenbank):

```powershell
npx prisma migrate dev --name add_event_series_audit_log
npx prisma generate
```

Der erste Befehl erstellt **und wendet** die Migration auf der konfigurierten
Entwicklungsdatenbank an. Nur zur Erstellung ohne Anwendung:
`npx prisma migrate dev --create-only --name add_event_series_audit_log`.
Keine bestehende Datenbank zurücksetzen. Vorhandene Produktions-/Deployment-
Konfiguration bleibt unverändert. Ohne AuditLog-Tabelle schlagen Series-Writes
absichtlich fehl und rollen zurück; die UI meldet eine nicht verfügbare Historie.

Es wurden keine Tests ausgeführt. Vor produktiver Freigabe sind echte PostgreSQL-
Integrationsprüfungen für Commit/Rollback (auch abgefangene Auditfehler), parallele
Writes, Bulk/skipDuplicates, UPSERT, Trainer-SetNull, Mandantentrennung,
Kontextisolation und gesperrte Umgehungswege erforderlich. Transaktions-Mocks
belegen diese Datenbankeigenschaften nicht.
