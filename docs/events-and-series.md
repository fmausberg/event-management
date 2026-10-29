# Events und Eventserien

## Company-Events

Events werden unter `/company/[companyKey]/events` verwaltet.
Aktive COMPANY_USER und COMPANY_ADMIN sowie globale ADMINs können die
Company-Eventaktionen verwenden. Company, Event, ausgewählte Venue, Serie und
Trainer werden serverseitig zugeordnet und geprüft.

Entwürfe können unvollständig gespeichert werden. Veröffentlichen verlangt Name,
Kurzbeschreibung, Beginn, Ende, Teilnehmerzahl, Ticketpreis und Venue sowie ein
zukünftiges Ende. Bei fehlendem Titelbild, Trainer oder Beschreibung fordert
das Formular eine zusätzliche Bestätigung. Das Ende muss nach dem Beginn liegen.
Der Company-Editor speichert EUR und akzeptiert keine frei manipulierte Währung.

Statusaktionen und ihre Wirkung: [Eventstatus](event-status.md).
Bilder und Dateibehandlung: [Cloudinary](cloudinary.md).
Buchungen und Löschschutz: [Buchungsverwaltung](booking-management.md).

## Vorgaben bei neuen Events

Eine Serie liefert Name, Kurzbeschreibung, Beschreibung, Venue, Trainer,
Kapazität, Preis, Stornofrist und Titelbild als Vorgaben.
Das Event erhält eigene gespeicherte Werte.

`EventSeries.suggestedDuration` enthält optional positive ganze Minuten.
Bei neuen Events berechnet das Formular das Ende aus Beginn plus Dauer.
Ein manuell verändertes Ende bleibt erhalten; ein geleertes Endfeld aktiviert
die Berechnung bei der nächsten Änderung wieder. Die Eingaben und Berechnung
im Company-Formular verwenden die lokale Browserzeitzone.
Events speichern Beginn und Ende, kein zusätzliches Dauerfeld.

Die ältere globale Eventbearbeitung verwendet dagegen die explizite
Europe/Berlin-Konvertierung in `lib/events/berlin-date-time.ts`.
Diese unterschiedlichen Eingabewege nicht als identische Zeitzonenlogik behandeln.

## Änderungen einer bestehenden Serie

`lib/event-series/update.ts` vergleicht normalisierte alte und neue Serienwerte.
Nur inhaltlich geänderte Attribute erhalten einen Vorschau-Tab mit ihrem Label.
Die Vorschau enthält zugehörige Events dieser Company, deren Beginn noch in der
Zukunft liegt und deren aktueller Attributwert vom vorgeschlagenen Wert abweicht.
Events ohne Beginn sind nicht enthalten. Die Abfrage filtert nicht zusätzlich
nach Eventstatus.

Das Dialogfenster zeigt je Attribut Datum, bisherigen Wert und vorgeschlagenen
Wert. Die Eventauswahl bleibt pro Attribut unabhängig. Vor der Übernahme müssen
alle Tabs besucht oder „Alle Vorschauen ansehen“ gewählt werden.
Abbrechen speichert weder Serie noch Eventänderungen.

Beim Bestätigen werden die Serie und ausschließlich die ausgewählten
Eventattribute gemeinsam in einer serialisierbaren Transaktion gespeichert.
Nicht ausgewählte Attribute bleiben unverändert; es gibt keine laufende
Vererbung bei späteren Seitenaufrufen. Ohne betroffene Eventzeilen kann die Serie
direkt gespeichert werden.

Die Vorschau ist mit AUTH_SECRET signiert, eine Stunde gültig und an den
gelesenen Serien-/Eventstand sowie die vorgeschlagenen Werte gebunden.
Ändern sich Daten zwischen Vorschau und Übernahme oder beginnt ein ausgewähltes
Event, muss die Vorschau erneuert werden. Ausgewählte IDs müssen zu den
vorgeschlagenen Zeilen gehören.

Eine übernommene Dauer setzt das Eventende relativ zum vorhandenen Beginn.
Eine übernommene Trainervorgabe ersetzt die Trainerzuordnungen des Events durch
den ausgewählten Trainer bzw. eine leere Auswahl.
Pflichtangaben veröffentlichter Events dürfen durch die Übernahme nicht geleert
werden. Neue Bilder werden erst beim Speichern hochgeladen; misslungene
Speichervorgänge bereinigen den neuen Upload.

Implementierung: `lib/event-series/preview.ts`, `lib/event-series/update.ts`
und `app/company/[companyKey]/event-series/_components/series-preview-dialog.tsx`.
Tests: `tests/event-series.test.ts` und `tests/event-series-preview.test.ts`.
