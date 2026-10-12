# Routenstruktur

```text
app/
├── (auth)/
│   ├── actions.ts              # Registrierung, Login, OAuth und Logout
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── verify-email/page.tsx
├── (public)/
│   ├── page.tsx
│   ├── events/
│   │   ├── page.tsx
│   │   └── [eventId]/page.tsx
│   └── company/[companyKey]/events/page.tsx
├── admin/
│   ├── events/                 # Vorhandene Eventverwaltung, inklusive new und [id]/edit
│   ├── event-series/page.tsx
│   ├── venues/page.tsx
│   └── users/page.tsx
├── company/[companyKey]/
│   ├── settings/page.tsx
│   ├── members/page.tsx
│   ├── venues/page.tsx
│   └── event-series/page.tsx
├── account/page.tsx
├── api/                       # Auth-Endpunkte und Webhooks
└── layout.tsx

components/                   # Gemeinsame UI neben app
├── auth-form.tsx
├── auth-page.tsx
└── placeholder-page.tsx

lib/                          # Auth-Logik, Datenbank und Fachlogik
```

Route Groups `(auth)` und `(public)` erscheinen nicht in URLs. `/login`,
`/register` und `/events` bleiben daher unverändert erreichbar. Die Root-Layout-
Datei gilt für alle Bereiche. Neue Fachseiten und `/verify-email` sind zunächst
Platzhalter ohne Datenbankzugriff, Buchungs- oder Verifizierungsfunktion.

Gemeinsame Komponenten werden über `@/components/...` importiert.
Die ausschließlich von der Eventverwaltung genutzten Komponenten bleiben
bei ihren Seiten in `app/admin/events/_components`.

Next.js verlangt für dasselbe dynamische URL-Segment einen einheitlichen Namen,
auch über Route Groups hinweg. Daher verwenden beide Company-Bereiche
`[companyKey]` statt konkurrierender `[companySlug]`- und `[companyId]`-Ordner:

- `/company/meine-company/events`: `companyKey` wird künftig über `Company.slug` aufgelöst.
- `/company/<company-id>/settings` (ebenso members, venues, event-series):
  `companyKey` wird künftig über `Company.id` aufgelöst.

Die Unterroute bestimmt die Bedeutung; es soll keine automatische Suche nach
wahlweise ID oder Slug geben. Die tatsächliche Datenauflösung folgt bei Umsetzung
der Fachseiten.

Die bestehende Eventverwaltung wurde nach `/admin/events` verschoben; Links,
Server-Action-Weiterleitungen und Revalidierungspfade wurden angepasst.
`/events` ist jetzt die öffentliche Platzhalterseite. Die alten leeren Seiten
unter `/company/[id]/...` wurden in die neue Company-Struktur überführt.

Ordnernamen und Route Groups vergeben keine Berechtigungen. Admin-Rollen sowie
Company-Mitgliedschaften müssen bei der fachlichen Umsetzung serverseitig an
den Datenzugriffen und Mutationen geprüft werden. Diese Strukturänderung führt
keine neuen Berechtigungsregeln ein; auch die bisherige Eventverwaltung erhält
dadurch noch keinen Admin-Zugriffsschutz. Login, Registrierung, Kontoseite und
Auth-API bleiben funktional erhalten.

Validierung: Next.js-Routentypen ohne Konflikte erzeugt; alle elf neuen
Platzhalter und beide Auth-Seiten per HTTP mit Status 200 geprüft.
99 Tests und ESLint erfolgreich. Der Produktionscode kompiliert; der abschließende
Typecheck bleibt durch die vorhandenen Schema-Abweichungen in
`lib/events/event-mutations.ts` und `tests/event-management.test.ts` blockiert.
