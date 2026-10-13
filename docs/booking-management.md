# Buchungsverwaltung

`/company/<company-slug>/events/<event-id>/bookings` ist die interne Verwaltung
aller Buchungen eines Events. Aktive Company-User, aktive Company-Admins und
globale Admins dürfen lesen, erstellen, bearbeiten und nach Bestätigung löschen.
Jeder Zugriff prüft Company, Event und gegebenenfalls Booking serverseitig.

Der Menüpunkt Events ist für alle aktiven Company-Mitglieder sichtbar. User
erhalten dort nur die Übersicht und den Bookings-Link; Eventänderungen bleiben
Admins vorbehalten. Das Booking-Formular öffnet sich rechts.

Bearbeitbar sind Kundenname, E-Mail, Platzanzahl und Bestätigt/Storniert. Neue
manuelle Buchungen sind intern, ohne Benutzerzuordnung oder externe ID. Ein
vorhandener Benutzerbezug und externe Referenzen bleiben beim Bearbeiten erhalten.
Fehlende Kundenangaben werden beim Lesen aus dem zugeordneten Account ergänzt.
Datum und Quelle sind in der Tabelle sichtbar und nicht editierbar.

Erhöhungen bestätigter Plätze werden in einer serialisierbaren Transaktion gegen
die Eventkapazität geprüft. Stornierungen und Reduktionen bleiben auch bei einer
bereits überbelegten Veranstaltung möglich. Diese Prüfung schützt die neuen
Verwaltungsaktionen; die spätere öffentliche Buchungsseite und externe Importer
müssen ihre Kapazitätsregeln separat berücksichtigen. Bei einem Transaktionskonflikt
wird zum Wiederholen aufgefordert.

Änderungen externer Buchungen gelten lokal; ein späterer Import kann sie
überschreiben oder gelöschte externe Buchungen erneut anlegen. Es erfolgen weder
E-Mail-Versand noch Zahlungsaktionen. Es ist keine Schemaänderung erforderlich.
