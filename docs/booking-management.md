# Buchungsverwaltung

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

Bei Events mit Eventbrite-Zuordnung steht im Buchungsbereich zusätzlich
**„Eventbrite-Buchungen synchronisieren“** bereit. Der manuelle Abgleich übernimmt
neue Buchungen sowie Änderungen und Stornierungen, ohne Duplikate, lokale Tickets
oder Mails zu erzeugen. Letzter erfolgreicher Import und Fehler werden angezeigt.
Details und erforderliche Migration: [Eventbrite-Buchungsimport](eventbrite.md#buchungen-per-knopfdruck-importieren).

Erhöhungen bestätigter Plätze werden in einer serialisierbaren Transaktion gegen
die Eventkapazität geprüft. Stornierungen und Reduktionen bleiben auch bei einer
bereits überbelegten Veranstaltung möglich. Diese Prüfung schützt die neuen
Verwaltungsaktionen; die öffentliche Buchungsseite verwendet eine eigene transaktionale Prüfung.
Externe Importe sind keine plattformübergreifende Reservierungsgarantie. Bei einem Transaktionskonflikt
wird zum Wiederholen aufgefordert.

Änderungen externer Buchungen gelten lokal; ein späterer Import kann sie
überschreiben oder gelöschte externe Buchungen erneut anlegen. Manuelles Erstellen/Bearbeiten startet weder Ticket-Mailversand noch Zahlungsaktionen.

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

## Offene Stripe-Zahlungen prüfen

In der Company- und Event-Buchungsübersicht erscheint bei einer Zahlung mit
Status `PENDING` der Button „Zahlung prüfen“. Während der Anfrage ist er gesperrt.
Die Übersicht aktualisiert sich anschließend; offene Zahlungen erhalten eine
neutrale Rückmeldung. Fehler enthalten keine technischen Details.

Die Server Action prüft Anmeldung und Company-Zugriff über
`requireCompanyAccess`: aktive `COMPANY_USER` und `COMPANY_ADMIN` der Company
sowie Plattform-Admins (`ADMIN`) sind berechtigt. Die Buchung wird innerhalb
der autorisierten Company geladen. Zahlungsstatus, Session-ID und Stripe-Konto
stammen ausschließlich aus der Datenbank.

`ensureCheckout(..., { existingOnly: true })` liest ausschließlich eine vorhandene
Session im gespeicherten Stripe-Konto. Es wird keine Session angelegt und keine
Zahlung oder Erstattung gestartet. Fehlende Sessions erfordern Support.
Die Stripe-Metadaten müssen zur autorisierten Zahlung und Buchung gehören;
`applyCheckoutSession` prüft zusätzlich Session-ID, Betrag, Währung, Modus und
Steuerdaten. Nur `complete` zusammen mit `paid` bestätigt die Buchung und stellt
Tickets samt dauerhafter Mail-Outbox aus. Der bestehende Mailversand wird angestoßen;
Versandfehler bleiben über die Outbox wiederholbar.

Nur ein von Stripe bestätigtes `expired` lässt die Reservierung ablaufen.
Offene oder fehlgeschlagene, aber nicht abgelaufene Sessions bleiben gemäß der
bestehenden Fulfillment-Logik ausstehend; die Uhrzeit allein verändert nichts.
Serialisierbare Transaktionen mit Konfliktwiederholung und Statusprüfung verhindern
doppelte Ticketausstellung bei parallelen Webhooks oder manuellen Prüfungen.
