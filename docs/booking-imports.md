# Externe Buchungen importieren

Auf `/company/[companyKey]/bookings` öffnet **Buchungen importieren** den
Assistenten. **Importhistorie** zeigt dauerhaft alle bestätigten Läufe und
ihre Ergebnisse. Vorschau und Dateieinlesen schreiben keine Importdaten;
lediglich das vorhandene Rate-Limit wird aktualisiert. Die Originaldatei
wird ausschließlich im Arbeitsspeicher verarbeitet und nicht gespeichert.

## Ablauf

1. `.xlsx` oder `.csv` wählen, Plattform aus dem vorhandenen Enum auswählen,
   optional einen Importnamen vergeben, Datei einlesen.
2. Tabellenblatt wählen. Ein einzelnes Blatt oder ein Blatt namens
   `Käuferliste` wird vorausgewählt. Pro Lauf wird genau ein Blatt importiert.
   Eindeutige bekannte Überschriften werden vorgeschlagen; jedes Mapping
   bleibt sichtbar und änderbar. Nicht benötigte Spalten bleiben unzugeordnet.
3. Vorschau laden und **jedes Quell-Event ausdrücklich einem Company-Event
   zuordnen**. Alternativ die betreffenden Zeilen ausschließen. Vorschläge
   sind keine verbindlichen Zuordnungen, auch wenn nur ein Kandidat existiert.
4. Vorschau aktualisieren, Fehler beheben oder Zeilen ausschließen,
   Warnungen und Kapazität prüfen und den Import ausdrücklich bestätigen.

Die Vorschau ist seitenweise mit 50 Zeilen bedienbar. Die Event-Auswahl
zeigt je Gruppe maximal 100 manuelle Suchtreffer zusätzlich zu Vorschlägen;
über Titel, Datum, Location oder Event-ID sind sämtliche Company-Events
innerhalb der MVP-Grenze auffindbar. Änderungen an Quelle,
Mapping, Ausschlüssen oder Event-Zuordnungen sperren die Bestätigung bis
zur erneuten Vorschau. Fehlerhafte Quellwerte werden in der lokalen Datei
korrigiert und diese neu eingelesen; eine Zellbearbeitung im Browser gibt es
im MVP nicht. Mengen, Kaufdatum und Bruttogesamtbetrag sind Pflichtmappings.
Name/E-Mail und externe ID dürfen fehlen, erzeugen dann Warnungen.

Ohne Eventspalten ist eine gemeinsame manuelle Event-Zuordnung möglich.
Ungültige zugeordnete Datumswerte bleiben Fehler, auch nach Event-Auswahl.
Es werden keine Events angelegt. Mehrere Veranstaltungen in einem Blatt
werden getrennt zugeordnet.

## Event-Vorschläge und Kapazität

Gruppiert wird nach dem getrimmten Quell-Eventtitel und dem ursprünglichen
Veranstaltungsdatum einschließlich Uhrzeit. Unterschiedliche Darstellungen
derselben Zeit können getrennte Gruppen erzeugen, die separat zu bestätigen
sind. Location ist ein zusätzlicher Suchhinweis, keine Identität.

Kandidaten stammen ausschließlich aus der aktuellen Company. Bewertung:
normalisierte gemeinsame Titelwörter (Jaccard, bis 50 Punkte), gleicher
Kalendertag in Europe/Berlin (30), gleiche Uhrzeit (15) bzw. bis zu einer
Stunde Abstand (5), Location-Ähnlichkeit (bis 5). Höchstens fünf Kandidaten
ab 25 Punkten werden vorgeschlagen. Zusätzlich sind alle Company-Events
wählbar; stornierte Events werden serverseitig abgelehnt. Es findet
**keine automatische Event-Auswahl** statt.

Bestätigte und ausstehende externe Buchungen belegen Plätze über die
vorhandenen `CONFIRMED`-/`PENDING_PAYMENT`-Aggregate. Die Vorschau zählt
bereits belegte/reservierte Plätze plus sämtliche importierbaren Zeilen
pro Event. Duplikate und ausgeschlossene Zeilen zählen nicht zusätzlich.
Kapazitätsüberschreitungen blockieren; `maxSeats = null` bedeutet gemäß
bestehender manueller Buchungslogik Kapazität 0.
Der Commit prüft dies erneut innerhalb einer serialisierbaren Transaktion.

## IDs, Duplikate und Wiederholungen

Die frühere globale Eindeutigkeit `(platform, externalBookingId)` konnte
zwischen unabhängigen Companies kollidieren. Die Migration ersetzt sie
durch `(externalCompanyId, platform, externalBookingId)` und füllt die
Company aus dem jeweiligen Event nach. Ein DB-Trigger leitet den Wert bei
jedem Schreiben erneut aus dem Event ab. Events mit Buchungen dürfen die
Company nicht wechseln. Externe IDs werden getrimmt, ihre Schreibweise
bleibt ansonsten unverändert. `null`-IDs bleiben mehrfach zulässig.

Die freie Importbezeichnung ist bewusst **kein** Bestandteil der Identität:
ein Umbenennen eines Imports darf den Duplikatschutz nicht aushebeln.
Der MVP setzt voraus, dass die ID innerhalb einer Company/Plattform einen
Verkauf identifiziert. Mehrere Plattformkonten mit kollidierenden IDs
innerhalb derselben Company benötigen zukünftig eine explizite, stabile
Kontenidentität; sie dürfen nicht über wechselnde Freitextnamen umgangen
werden. Ticket-IDs werden ausschließlich als Rohzellen aufbewahrt.

Bestehende IDs und Wiederholungen innerhalb der Datei werden übersprungen,
nie überschrieben. Eine ungültige frühere Zeile blockiert keine spätere
gültige Zeile mit derselben ID. Bereits vorhandene Duplikate erzeugen keine
neue Buchung, auch wenn andere Werte abweichen. Rohwerte und Ergebnis
bleiben im Lauf nachvollziehbar.
Ohne externe ID warnt ein Fingerprint aus Event, E-Mail, Kaufdatum, Menge,
Betrag und Währung vor möglichen Duplikaten in Datei und Datenbank; er
überspringt nichts automatisch und ist kein verlässlicher Identitätsbeweis.

`createMany(skipDuplicates)` schützt gegen eindeutige Schlüsselkonflikte,
ohne die Transaktion durch einen Einzelzeilenfehler unbrauchbar zu machen.
Serialisierungs-/Eindeutigkeitskonflikte wiederholen die gesamte Transaktion
höchstens zweimal; danach wird kein Teilimport hinterlassen. Die
Importkennung ist einmalig und macht eine wiederholte Bestätigung desselben
Laufs idempotent, auch ohne externe Buchungs-IDs. Neue Läufe ohne externe
IDs können weiterhin zusätzliche Buchungen erzeugen.
Der bestehende Integrations-Upsert verwendet ebenfalls den neuen Schlüssel;
er darf importierte Buchungen mit Preis-Snapshot weiterhin nicht verändern.

## Rausgegangen, Geld, Datum und Erstattungen

Die bekannten `Käuferliste`-Überschriften werden einzeln erkannt, unter anderem
`Käufer Vorname`, `Käufer Nachname`, `Email Adresse`, `Summe in € (Brutto)`,
`Anzahl Tickets`, `Eventtitel`, `Location`, `Veranstaltungsdatum`, `Kaufdatum`,
`Erstattungsdatum`, `Erstatteter Betrag Brutto` und `Externe ID`.
`Bezahlmethode`, `Ticket IDs` und sonstige Gebühren-/Zahlungsspalten werden
nicht zu internen Zahlungs- oder Ticketdaten umgedeutet, aber als Rohzellen
im Company-Protokoll gespeichert. Da keine konkrete Datei im Repository
bereitgestellt wurde, basiert die Erkennung auf den beschriebenen Spalten.

Geld wird immer in der **Haupteinheit** gelesen: `39 €` → 3900,
`3,7 €` → 370, `6.23` → 623 Minor Units. Die Umwandlung trennt die
Ganzzahl- und Nachkommastellen; es wird kein Gleitkommabetrag mit 100
multipliziert. Deutsche Tausenderpunkte mit Dezimalkomma werden unterstützt,
mehr als zwei Nachkommastellen, negative oder mehrdeutige Werte abgelehnt.
`3900` bedeutet 3900 Euro, niemals implizit 3900 Cent. Cent-Spalten müssen
vorher umgerechnet werden. Ohne explizite Währung gilt EUR; dreistellige
Währungscodes werden geprüft. Ein Euro-Symbol bei expliziter anderer
Währung erzeugt einen Fehler. Der MVP verwendet zwei Minor-Unit-Stellen;
Währungen mit abweichender Unterteilung müssen vorerst ausgeschlossen
werden (siehe unterstützte Währungsprüfung im Normalisierer).

Excel-Datumszellen werden als lokale Datumsstrings erfasst. Numerische
Datumswerte unterstützen 1900-/1904-Excel-Epochen; deutsche Strings wie
`05.12.2026 15:30`, ISO-Daten und explizite Zeitzonen werden unterstützt.
Ohne Zeitzone gilt der vorhandene `parseBerlinDateTime`-Helfer, unabhängig
von der Serverzeitzone. Nicht existierende Sommerzeit-Uhrzeiten werden
abgelehnt; bei der doppelten Herbst-Uhrzeit wird wie im bestehenden
Eventeditor die frühere Instanz verwendet. Bei Bedarf ISO mit Offset nutzen.
Ein Datum ohne Uhrzeit bedeutet 00:00 Uhr.

Ohne externen Status gilt `CONFIRMED`. Nur die explizite Allowlist in
`normalize.ts` bildet bestätigte/bezahlte, stornierte, ausstehende und
abgelaufene Werte auf das vorhandene Status-Enum ab. Unbekannte Werte
blockieren die Zeile. Externe ausstehende Zahlungen reservieren Plätze
ohne automatische Ablaufzeit; der Import ist kein laufender Plattformabgleich.

**Bewusste MVP-Entscheidung:** Ein positives Erstattungsfeld, ein
Erstattungsdatum oder ein bekannter Erstattungsstatus bleibt als externe
Information erhalten und wird mit Warnung als `CONFIRMED` importiert.
Die Buchung bleibt kapazitätswirksam. Es wird keine vollständige oder
teilweise interne Stornierung aus einer Plattformerstattung abgeleitet;
das bestehende Statusmodell kann Teilrückgaben nicht angemessen abbilden.
Ein Widerspruch wie Erstattung größer als Brutto blockiert die Zeile.
Im Zweifel diese Zeilen ausschließen und außerhalb dieses MVP abklären.

Es entstehen **keine Payments, Stripe-IDs, Refund-Aufträge, internen
Tickets, Ticket-Tokens, Kundenmails oder Userzuordnungen**. Externe
Ticket-IDs werden nicht als interne IDs verwendet.

Jede importierte Booking erhält einen unveränderlichen BookingPrice mit
`calculationVersion = 2`: der externe Gesamtbruttobetrag bleibt exakt,
der Grundbetrag je Ticket ist abgerundet, zusätzliche Cent-Plätze stehen
im `allocationSnapshot`. Rabatte/Gutscheine sind 0, Steuerangaben bleiben
unbekannt. Version 1 und bestehende Snapshots werden nicht umgeschrieben;
der Append-only-Trigger bleibt aktiv. Ein zusätzlicher Insert-Trigger
verlangt für Version 2 eine passende externe Booking inklusive Company,
Event und Menge. Die erweiterten CHECK-Regeln erlauben beliebige gültige
externe Gesamtbeträge bei konsistenter Summenrechnung.

Company- und Event-Buchungslisten zeigen den Betrag als **extern erfasst,
keine Stripe-Zahlung**. Die Company-Liste verlinkt den Import und zeigt
Quelle sowie externe ID. Version-2-Buchungen sind aus der bestehenden
Stripe-Umsatz-, Listenpreisvergleichs-, Gebühren- und Steuerberechnung
ausgeschlossen; es wird keine externe Umsatzkennzahl als Steuerbeleg
angeboten. Erstattungswerte sind in Vorschau und Importzeilendetails sichtbar.

## Grenzen und Verarbeitung

| Grenze | MVP |
| --- | --- |
| Upload | 5 MiB, nur `.xlsx`/`.csv`, passende MIME-Typen bzw. Octet-Stream |
| Datenzeilen | insgesamt 1.000 über alle Blätter; pro Blatt maximal 1.001 physische Excel-Zeilen inklusive Kopfzeile |
| Spalten | 80, eindeutige nicht leere Überschriften, jeweils maximal 255 Zeichen |
| Tabellenblätter | 10; je bestätigtem Lauf ein ausgewähltes Blatt |
| Quell-Eventgruppen | 100 pro Lauf |
| Company-Events | maximal 5.000 für Kandidaten und manuelle Auswahl |
| Rohwerte je Zeile | maximal 24 KiB JSON (DB zusätzlich 32 KiB je JSON-Feld) |
| Zellwerte insgesamt | maximal 6 MiB JSON |
| XLSX-Container | maximal 300 ZIP-Einträge, maximal 20 MiB entpackt; tatsächliche Inflationsgrößen werden geprüft |
| Dateiparser | 10 Sekunden, Worker mit 128 MiB Old-/32 MiB Young-Heap, maximal zwei Parser gleichzeitig pro Node-Prozess |
| Vorschau | 15 Sekunden inklusive Kandidatenberechnung, wiederholte Grenzenprüfung |
| Commit | Transaktionslimit 60 Sekunden je Versuch, maximal drei Versuche |
| Anfragen | 60 Dateieinlese-/Vorschau-/Bestätigungsanfragen je Company und 15-Minuten-Fenster im bestehenden DB-Rate-Limit |
| CSV | UTF-8, UTF-8-BOM oder UTF-16LE-BOM; Semikolon, Komma, Tabulator |

[ExcelJS](https://github.com/exceljs/exceljs#reading-xlsx) und
[csv-parse](https://csv.js.org/parse/options/) laufen nur serverseitig in einem isolierten Worker;
der Browser erhält keine Excel-Bibliothek. ZIP-Größen werden vor ExcelJS
geprüft; Formeln und Excel-Fehlerzellen werden abgelehnt. Formeln werden
nie ausgeführt. Vorher als reine Werte exportieren. Vollständig leere
Zeilen werden übersprungen; Quellzeilennummern bleiben nachvollziehbar.
Dateityp-/Parserfehler enthalten keine Rohwerte. Worker werden bei Zeit-
oder Speicherüberschreitung beendet. Die bestehenden Server Actions
begrenzen den gesamten Request zusätzlich auf 12 MiB.

Der Parser benötigt den Node-Runtime-Server, keine Edge Runtime. Beide
Pakete sind `serverExternalPackages`; Tracing nimmt die Parserpakete für
das bestehende Standalone-Deployment mit. Keine öffentlich abgelegten
Dateien und keine zusätzlichen Secrets erforderlich.
Die Laufzeitauflösung der Pakete geschieht innerhalb des Node-Workers.
Ein dynamisches `createRequire` im gebündelten Next.js-Code wird vermieden,
da webpack diesen Aufruf sonst durch `undefined` ersetzen kann.

## Datenzugriff, Historie und Löschung

Alle Einstiegsseiten und Server Actions verwenden `requireCompanyAccess`;
zugelassen sind aktive Company-Mitglieder oder Plattform-Admins gemäß
bestehendem Muster. Event-IDs werden erneut auf die Company geprüft,
Plattform und Mapping serverseitig validiert, Statuswerte aus Quelldaten
über eine Allowlist abgeleitet. Clientdaten ersetzen keine Autorisierung.

`BookingImport` speichert Company, Plattform, Ersteller, Name, Datei-/Blattname,
Beginn/Abschluss, Mapping und Ergebniszähler. `BookingImportRow` speichert
Quellzeilennummer, ursprüngliche Überschriften/Zellwerte inklusive **aller
nicht leeren unzugeordneten Spalten**, normalisierte Werte, den tatsächlich
geschriebenen Preis-Snapshot, Event, Ergebnis und optional die erstellte
Booking. Auch ausgeschlossene, fehlgeschlagene und doppelte Zeilen bleiben
nachvollziehbar. Bereits bestehende Duplikat-Bookings werden nicht verändert
oder einem neuen Import zugeordnet. Kalenderzellen werden als ISO-Wandzeit
serialisiert; andere primitive Zellwerte werden unverändert aufbewahrt.

Der bestätigte Lauf wird mit Bookings, BookingPrice und Zeilen in **einer
Transaktion** geschrieben. Bei globalen Fehlern gibt es keinen halben Lauf.
Der zentrale auditierte Prisma-Client und ein authentifizierter Auditkontext
bleiben aktiv. Eine explizite Audit-Policy protokolliert Lauf-Metadaten,
Zähler und Rohdatenlöschung; Dateinamen, freie Bezeichnungen, Zellwerte,
Mapping und normalisierte personenbezogene Daten gelangen nicht ins AuditLog.

Die Historie ist dauerhaft, bis die Company ihre Importdaten ausdrücklich
löscht. Empfohlener Betrieb: Company-Admins prüfen offene Fehler direkt
nach dem Import und löschen personenbezogene Importdaten nach Abschluss
der Abklärung, spätestens im regelmäßig durchgeführten 90-Tage-Review,
sofern keine dokumentierte Aufbewahrungspflicht entgegensteht. Diese
Review-Frist ist **kein automatischer Löschjob**; im MVP entscheidet die
Company über den Löschzeitpunkt. Vor dem Hochladen unnötige sensible
Spalten aus der Datei entfernen, da explizit alle Quellwerte gespeichert
werden. Backups müssen denselben dokumentierten Zugriffs- und
Aufbewahrungsregeln unterliegen und planmäßig auslaufen.

Company-Admins und Plattform-Admins können im Laufdetail nach expliziter
Bestätigung **Rohzellen, normalisierte Daten, Fehlermeldungen, Mapping,
freie Bezeichnung, Datei- und Blattname löschen**. Der Lauf samt
Ergebniszählern, Ersteller, Plattform, Zeiten, Quellzeilennummern und
Event-/Booking-Verknüpfungen bleibt erhalten. Buchungen mit ihren
Kundenstammdaten und finanziellen Snapshots werden dadurch nicht gelöscht;
ihre gesonderten Aufbewahrungs-/Betroffenenprozesse gelten weiterhin.
Es gibt bewusst kein „Import rückgängig machen“, das referenzierte oder
später veränderte Bookings unbemerkt entfernen könnte.

Rohdaten werden nur als React-escaped JSON auf autorisierten Seiten
angezeigt, weder öffentlich veröffentlicht noch in Logs ausgegeben. Der
MVP exportiert keine Rohdaten als CSV. Für jeden späteren CSV-/Excel-Export
müssen Zellen mit führendem `=`, `+`, `-`, `@`, Tabulator oder Zeilenumbruch
zusätzlich gegen Spreadsheet-Formel-Injection neutralisiert werden; bloßes
CSV-Quoting reicht nicht. Die Originalwerte im Protokoll dürfen dafür
nicht nachträglich verändert werden.

## Deployment

Die Migration `20261118120000_external_booking_import` ist erforderlich.
Vor Deployment Datenbanksicherung gemäß bestehendem Betriebsprozess
erstellen. Im vorhandenen Migrationscontainer bzw. Deploymentprozess
`prisma migrate deploy` ausführen, dann Anwendung mit aus dem neuen Schema
generiertem Prisma-Client bereitstellen. `prisma generate` wird bereits
über `predev`/`prebuild` ausgeführt. Die Migration füllt den Company-Schlüssel
vor dem Austausch des Unique-Indexes nach und ändert keine vorhandenen
Preissnapshots. DDL/Backfill benötigt Tabellenlocks; Deployment ohne
parallele alte App-Instanzen planen, da der alte Unique-Selector entfällt.
Kein `migrate dev` und kein `db push` gegen Produktion.

In dieser Umsetzung wurde der Prisma-Client lokal regeneriert; es wurde
keine Migration angewendet. Tests, Lint, Typprüfung und Build wurden auf
ausdrücklichen Wunsch nicht ausgeführt.
Die Normalisierungsfälle sind in `tests/booking-import-normalize.test.ts`
vorbereitet, aber ebenfalls nicht ausgeführt. Das bestehende
`event-management.test.ts` verwendet den neuen Company-Schlüssel.

## Geänderte und neue Dateien

- Oberfläche: `app/company/[companyKey]/bookings/table.tsx`,
  `import/page.tsx`, `import/wizard.tsx`, `import/actions.ts`,
  `import/page-access.ts`, `imports/page.tsx`, `imports/[importId]/page.tsx`,
  `imports/[importId]/erase-data.tsx`
  (alle relativen Pfade unter derselben Company-Buchungsroute).
- Import-Service: `lib/bookings/import/types.ts`, `errors.ts`, `parser.ts`,
  `normalize.ts`, `service.ts`.
- Bestehende Buchungsintegration: `lib/bookings/company.ts`, `management.ts`,
  `payment-summary.ts`, `revenue.ts`, `upsert-external-booking.ts`.
- Audit/Betrieb: `lib/audit/policy.ts`, `lib/auth/rate-limit.ts`,
  `next.config.ts`, `package.json`, `package-lock.json`.
- Datenmodell: `prisma/schema.prisma`,
  `prisma/migrations/20261118120000_external_booking_import/migration.sql`.
- Dokumentation: `docs/booking-imports.md`, `docs/booking-management.md`,
  `docs/project-structure.md`.
- Nicht ausgeführte Testdateien: `tests/booking-import-normalize.test.ts`,
  `tests/event-management.test.ts`.
