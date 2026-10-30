# Projektstruktur und Routen

## Öffentliche Seiten und Kundenkonto

| Route | Zweck |
| --- | --- |
| `/` | Einstieg |
| `/login`, `/register`, `/verify-email` | Anmeldung, Registrierung und Bestätigung |
| `/events` | Öffentliche Eventübersicht |
| `/events/[companySlug]` | Eventliste einer Company |
| `/events/[companySlug]/[eventId]` | Eventdetails und Buchung |
| `/booking/payment/[token]` | Zahlung fortsetzen und Status prüfen |
| `/tickets#<code>` | Öffentliches Ticket über geheimen Fragment-Link |
| `/account` | Kontoübersicht |
| `/account/bookings` | Eigene Buchungen und Stornierungsaktionen |
| `/account/events` | Persönliche Eventübersicht |
| `/account/tickets/[ticketId]` | Eigenes Ticket nach Eigentumsprüfung |
| `/account/scan` | Tickets prüfen und bei Berechtigung einlösen |

Route Groups `(auth)` und `(public)` erscheinen nicht in der URL.

## Verwaltung

Company-Seiten liegen unter `/company/[companyKey]`.
`companyKey` bezeichnet den eindeutigen **Company-Slug**, keine Datenbank-ID.
Die Anwendung löst ihn serverseitig zur internen ID auf und prüft die Zugehörigkeit
der angeforderten Datensätze.

| Suffix | Zweck |
| --- | --- |
| `/settings` | Company-Einstellungen und Stripe-Anbindung |
| `/members` | Mitglieder und Rollen |
| `/venues` | Veranstaltungsorte und Staff |
| `/trainers` | Trainerverwaltung |
| `/event-series` | Reihen und Vorgaben |
| `/event-series/[seriesId]` | Reihendetails und zugehörige Events |
| `/events` | Eventverwaltung |
| `/events/[eventId]/bookings` | Buchungsverwaltung |
| `/events/[eventId]/tickets` | Ticketverwaltung |
| `/cancellations` | Stornierungsanfragen und Erstattungen |

Globale Verwaltungszugänge liegen unter `/admin`, unter anderem Companies,
Events, Eventserien, Venues, Trainer und User. Einzelne Zugänge führen zur
Company-Auswahl oder verwenden die Company-Verwaltung; der URL-Präfix allein
legt keine Berechtigung fest.

## Codezuständigkeiten

- `app/`: Seiten, Route Handler, Server Actions und seitenspezifische Komponenten.
- `components/`: gemeinsam verwendete UI.
- `lib/`: Datenzugriff, Autorisierung und Fachlogik nach Thema.
- `prisma/schema.prisma` und `prisma/migrations/`: Datenmodell und Migrationen.
- `tests/`: automatisierte Vitest-Tests.
- `docs/`: Einrichtung, Fachregeln und Betrieb.
- `.github/workflows/deploy.yml`: Deployment bei Push auf main.

Die Navigation wird aus Session, aktueller globaler Rolle und aktiven
Company-Mitgliedschaften aufgebaut. Company-Links verwenden Slugs.
Die Sichtbarkeit eines Links ersetzt keine serverseitige Berechtigungsprüfung.
Rollenänderungen werden bei einer neuen serverseitigen Layout-Auswertung sichtbar.

Die globale Company-Verwaltung prüft die aktuelle Rolle ADMIN.
Die Mitgliederverwaltung benötigt Company-Adminrechte oder eine globale Adminrolle.
Andere Verwaltungsaktionen haben eigene Regeln; insbesondere unterscheiden sich
Company-Ticketverwaltung, Kamera-Scanner und Ticket-Neuversand.
Details stehen in [Mitglieder](company-members.md),
[Buchungsverwaltung](booking-management.md), [Mail und Check-in](mail.md)
und [Ticket-Outbox](ticket-outbox.md).

Slug-Änderungen ändern öffentliche und Verwaltungs-URLs; alte URLs werden nicht
automatisch weitergeleitet.

## API

- `/api/auth/[...nextauth]`: Auth.js.
- `POST /api/public-ticket`: geschützter Abruf öffentlicher Ticketdaten.
- `POST /api/webhooks/stripe`: signaturgeprüfte Stripe-Events.
- `POST /api/payments/reconcile`: autorisierter Zahlungs-, Erstattungs- und Mailabgleich einschließlich zeitgesteuerter [Trainer-Reminder](trainer-reminders.md).
- `/api/health`: Datenbank-Erreichbarkeit.
- `POST /api/webhooks/eventbrite`: nicht implementiert, HTTP 501.

Prüfungen und deren Grenzen: [Testing](testing.md).
