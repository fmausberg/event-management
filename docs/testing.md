# Prüfungen

## Befehle

Nach `npm ci` und `npm run db:generate`:

```sh
npm test
npm test -- tests/ticket-resend.test.ts
npm run lint
npx tsc --noEmit
npx prisma validate
npm run build
```

`npm test` startet `vitest run`: ein vollständiger Durchlauf ohne Watch-Modus.
`vitest.config.mts` erfasst `tests/**/*.test.ts`; Standardumgebung ist Node.js,
einzelne Komponententests verwenden jsdom. `npx vitest` startet bei Bedarf
den interaktiven Watch-Modus. Die Prisma-CLI benötigt die passende Konfiguration. Die oben aufgeführten
Prüfbefehle migrieren keine Datenbank.
Der Build führt `prisma generate` als prebuild aus, aber keine Tests.

## Was die Tests absichern

- Anmeldung, Passwort-Hashing, Sitzungen und E-Mail-Verifizierung.
- Company-Zugriffe und Schutz vor Zugriffen auf fremde Datensätze.
- Events, Serienvorschau, Buchungen und Kapazitätsgrenzen.
- Stripe-Freigabe, wiederholte Webhooks und Erstattungszustände.
- Stornofristen, Ticketcodes, Zugriff und einmaligen Check-in.
- Mailvorlagen, Versandaufträge, Wiederholungen und Archivierungsaufrufe.
- Ausgewählte Komponenten, Navigation und Darstellung.

Viele Tests führen echte Fachlogik mit simulierten Datenbank- oder Dienstaufrufen
aus. Der Auth-HTTP-Test verwendet echtes Auth.js mit einer simulierten Datenbank.
jsdom und statisches React-Rendering sind keine vollständigen Browsertests.

## Grenzen und zusätzliche Betriebsprüfung

Ein grüner Lauf beweist weder die Erreichbarkeit von PostgreSQL, Stripe oder
STRATO noch eine erfolgreiche Migration, Mailzustellung oder Archivierung.
Echte Constraints, Transaktionssperren und parallele Schreibzugriffe brauchen
Integrationstests gegen eine separate PostgreSQL-Testdatenbank.
Für externe Dienste sind ergänzende Abläufe in einer Testumgebung nötig:
Checkout und Erstattung in der Stripe-Sandbox, SMTP/IMAP sowie Kamera-Check-in
im Browser. Konkrete Hinweise stehen in den jeweiligen Fachanleitungen.
Testdaten und Zugangsdaten von produktiven Daten trennen.

## Wann Prüfungen laufen

| Auslöser | Verhalten |
| --- | --- |
| `npm test` | Führt die Vitest-Suite aus |
| `npm run dev`, `npm run build`, Docker-Build | Kein Vitest-Aufruf |
| Pull Request | Im eingecheckten Workflow keine automatische Testsuite |
| Push auf `main` | `.github/workflows/deploy.yml` startet das Deployment ohne Testschritt |
| Laufende Docker-App | Healthcheck prüft `/api/health`, keine Testsuite |

Ein Coding-Agent kann Tests während seiner Arbeit ausführen; das ist kein
dauerhafter CI-Schritt. Für eine automatische Freigabe vor dem Deployment muss
ein eigener Prüfjob eingerichtet und das Deployment davon abhängig gemacht werden.
Diese Dokumentation beschreibt den vorhandenen Ablauf und ändert ihn nicht.
