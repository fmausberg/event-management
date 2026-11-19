# Buchungsverwaltung

Die Company-Übersicht `/company/[companyKey]/bookings` bietet den Excel-/CSV-Import
externer Verkäufe mit Vorschau und dauerhafter Importhistorie. Importierte
Buchungen besitzen unveränderliche Preis-Snapshots, werden nicht durch
wiederholte Dateiimporte überschrieben und erzeugen keine internen Tickets
oder Stripe-Zahlungen. Ablauf, Berechtigungen, Grenzen, Erstattungsentscheidung
und Aufbewahrung: [Externe Buchungsimporte](booking-imports.md).

`/company/<company-slug>/events/<event-id>/bookings` ist die interne Verwaltung
aller Buchungen eines Events. Aktive Company-User, aktive Company-Admins und
globale Admins dürfen lesen, erstellen, bearbeiten und nach Bestätigung löschen.
Jeder Zugriff prüft Company, Event und gegebenenfalls Booking serverseitig.

Der Menüpunkt Events ist für alle aktiven Company-Mitglieder sichtbar. Beide
Company-Rollen können auch die Company-Eventverwaltung verwenden; die aktuellen
Aktionen prüfen die aktive Mitgliedschaft serverseitig. Das Booking-Formular öffnet sich rechts.

Bearbeitbar sind Kundenname, E-Mail, Platzanzahl und Bestätigt/Storniert. Neue
manuelle Buchungen sind intern, ohne Benutzerzuordnung oder externe ID. Ein
vorhandener Benutzerbezug und externe Referenzen bleiben beim Bearbeiten erhalten.
Fehlende Kundenangaben werden beim Lesen aus dem zugeordneten Account ergänzt.
Datum und Quelle sind in der Tabelle sichtbar und nicht editierbar.

Erhöhungen bestätigter Plätze werden in einer serialisierbaren Transaktion gegen
die Eventkapazität geprüft. Stornierungen und Reduktionen bleiben auch bei einer
bereits überbelegten Veranstaltung möglich. Diese Prüfung schützt die neuen
Verwaltungsaktionen; die öffentliche Buchungsseite verwendet eine eigene transaktionale Prüfung.
Externe Importe sind keine plattformübergreifende Reservierungsgarantie. Bei einem Transaktionskonflikt
wird zum Wiederholen aufgefordert.

Änderungen älterer externer Buchungen ohne finanzielle Historie gelten lokal;
ein späterer Integrations-Upsert kann sie überschreiben oder gelöschte
externe Buchungen erneut anlegen. Der Excel-/CSV-Dateiimport überschreibt
dagegen keine Buchungen und schützt seine Preis-Snapshots dauerhaft.
Manuelles Erstellen/Bearbeiten startet weder Ticket-Mailversand noch Zahlungsaktionen.

## Tickets erneut senden

Die Buchungsübersicht bietet eine eigene Aktion für aktive COMPANY_USER und
COMPANY_ADMIN der Event-Company. Unbestätigte Buchungen, abgesagte Events,
fehlende Buchungsadressen oder fehlende gültige, nicht eingelöste Tickets zeigen
einen deaktivierten Button mit Begründung. Eine globale Adminrolle ohne aktive
Company-Mitgliedschaft reicht für diese Aktion nicht aus. Manuelle Buchungen ohne
Tickets erhalten dadurch keine neuen Tickets.

Der Versand verwendet ausschließlich booking.customerEmail; ein Profil-Fallback
in der Tabelle gilt nicht als gespeicherte Buchungsadresse. Die UI meldet
„Versand beauftragt“. Regeln, Audit und Migration: [Ticket-Outbox](ticket-outbox.md).
In der Company-Ticketübersicht gibt es keine zusätzliche Versandaktion.
