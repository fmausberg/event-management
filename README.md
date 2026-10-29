# Event- und Ticketverwaltung

Webplattform für Companies, Veranstaltungsreihen, Events, Buchungen und Tickets.
Technik: Next.js App Router, TypeScript, Prisma 7 und PostgreSQL.
Stripe Connect ermöglicht Direct Charges; SMTP und IMAP übernehmen Mailversand und Versandkopien.

## Lokal starten

Node.js 22 (wie im Dockerfile) und PostgreSQL werden benötigt.

1. `npm ci` ausführen.
2. `.env.example` nach `.env.local` kopieren und die Werte eintragen.
   Mindestens Datenbank, `AUTH_SECRET` und `AUTH_URL` konfigurieren;
   für Buchungen mit Tickets zusätzlich `TICKET_CODE_ENCRYPTION_KEYS`,
   für Verifizierungs- und Ticketmails SMTP.
3. Ziel-Datenbank und vorhandene Migrationen prüfen. Die eingecheckten Migrationen
   mit `npx prisma migrate deploy` auf die gewünschte Datenbank anwenden.
4. `npm run dev` starten.

`npm run dev` und `npm run build` erzeugen den Prisma-Client automatisch,
migrieren aber keine Datenbank. `npm run db:generate` erzeugt nur den Client.
Neue Schemaänderungen werden lokal mit `prisma migrate dev` entwickelt;
Server verwenden die eingecheckten Migrationen mit `prisma migrate deploy`.
Der tatsächliche Migrationsstand ist je Datenbank zu prüfen und lässt sich
nicht aus diesem Repository ableiten.

Secrets gehören in ignorierte Env-Dateien oder die Serverkonfiguration.
Für die Prisma-CLI haben Shell-Variablen Vorrang vor `.env.local` und `.env`.
CLI und Anwendung sollen dieselbe Ziel-Datenbank verwenden.

## Dokumentation

| Thema | Anleitung |
| --- | --- |
| Routen und Zuständigkeiten | [Projektstruktur](docs/project-structure.md) |
| Server, Docker, Traefik und Deployment | [Betrieb](docs/docker.md) |
| Testbefehle, Reichweite und automatische Ausführung | [Prüfungen](docs/testing.md) |
| Login, Passwörter, OAuth und Sitzungen | [Authentifizierung](docs/authentication.md) |
| E-Mail-Bestätigung und offene Zuordnungen | [Verifizierung](docs/email-verification.md) |
| Company-Mitglieder und Rollen | [Mitglieder](docs/company-members.md) |
| Events, Serienvorgaben und Änderungsvorschau | [Events und Serien](docs/events-and-series.md) |
| Entwurf, Veröffentlichung und Absage | [Eventstatus](docs/event-status.md) |
| Trainer und Eventzuordnung | [Trainer](docs/trainers.md) |
| Titelbilder | [Cloudinary](docs/cloudinary.md) |
| Buchungen verwalten und Tickets erneut senden | [Buchungsverwaltung](docs/booking-management.md) |
| Eigene Buchungen und Tickets | [Kundenkonto](docs/account-bookings.md) |
| Stornierungen und Erstattungen | [Stornierungen](docs/cancellations.md) |
| Gutschein-Fachregeln und Zustandsübergänge (noch nicht implementiert) | [Gutscheinkonzept](docs/vouchers.md) |
| Stripe-Onboarding, Checkout, Webhooks und Abgleich | [Stripe](docs/stripe.md) |
| SMTP, öffentliche Ticketlinks und Check-in | [Mail und Ticketzugänge](docs/mail.md) |
| Versandkopien im Gesendet-Ordner | [IMAP-Archivierung](docs/mail-sent-archive.md) |
| Ticketcodes, Verschlüsselung und Schlüsselrotation | [Ticketcodes](docs/ticket-codes.md) |
| Versandaufträge und automatische Wiederholungen | [Ticket-Outbox](docs/ticket-outbox.md) |
| Öffentliche Eventlisten einbetten | [Einbettung](docs/embed-events.md) |
| Kapazität und externe Eventplattformen | [Integrationen](docs/integrations.md) |

## Prüfungen

```sh
npm test
npm run lint
npm run build
```

Testdateien allein starten keine automatische Prüfung. Der aktuelle
GitHub-Workflow deployt Pushes auf `main` ohne Testschritt.
Details und Grenzen stehen in [Prüfungen](docs/testing.md).

## Dokumentation pflegen

Fachregeln und Einrichtung in der jeweils verlinkten Themendatei aktualisieren.
Die README bleibt der Einstieg; Arbeitsberichte, einmalige Testergebnisse und
umgebungsabhängige Migrationsstände gehören in Pull Requests bzw. Betriebsprotokolle.
`AGENTS.md` enthält Hinweise für Coding-Agenten; `CLAUDE.md` verweist darauf.
