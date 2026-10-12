# Authentifizierung

Die Integration verwendet Auth.js (`next-auth` 5.0.0-beta.32, explizit gepinnt),
den offiziellen Prisma-Adapter, Node.js-scrypt, bcryptjs für bestehende Hashes und Zod. Sie nutzt den vorhandenen
Prisma-7-Client mit PostgreSQL-Treiberadapter und Next.js App Router.

## Einrichtung

1. `.env.example` nach `.env.local` kopieren und `DATABASE_URL` setzen.
2. Mit `npx auth secret` ein eigenes `AUTH_SECRET` erzeugen. `AUTH_URL` auf die
   öffentliche Basis-URL setzen, lokal `http://localhost:3000`, produktiv HTTPS.
3. Optional Google und/oder GitHub konfigurieren. Jeweils **beide** Variablen
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` beziehungsweise
   `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` setzen. Unvollständig konfigurierte
   Anbieter sind deaktiviert. Die Variablen dürfen keinen `NEXT_PUBLIC_`-Präfix haben.
4. Beim Anbieter die exakte Callback-URL registrieren:
   - Google: `<AUTH_URL>/api/auth/callback/google`
   - GitHub: `<AUTH_URL>/api/auth/callback/github`
5. Vor dem Datenbankbetrieb muss die Schema-Erweiterung in einem separaten
   Schritt geprüft und migriert werden. **Diese Änderung enthält keine neue
   Migration und führt weder Migrationen noch `db push` aus.** `prisma generate`
   aktualisiert ausschließlich den Client; es erzeugt keine Datenbanktabellen.
6. Danach `npm run dev` starten und `/register` oder `/login` aufrufen.

Hinter einem vertrauenswürdigen Reverse Proxy kann `AUTH_TRUST_HOST=true` nötig
sein. Der Proxy muss fremde Host- und Forwarded-Header verwerfen/überschreiben.
Nicht pauschal für beliebige eingehende Hosts aktivieren.

## Verhalten und Datenhaltung

- Registrierung speichert normalisierte E-Mail-Adressen (trim + lowercase),
  Namen und gesalzene scrypt-Hashes (`scrypt-v1`, N=32768, r=8, p=3,
  16 zufällige Salt-Bytes, 64 abgeleitete Bytes). Passwörter werden nicht getrimmt,
  abgeschnitten, geloggt oder in Action-Antworten/Sessions zurückgegeben.
  Es gibt keine Längen- oder Komplexitätsvorgaben; nur eine nicht leere Eingabe
  und die identische Wiederholung sind erforderlich. Die allgemeinen
  Größenlimits für HTTP-Anfragen/Server Actions gelten weiterhin.
  Bestehende bcrypt-Hashes bleiben beim Login unterstützt. Bei diesen zuvor auf
  72 Bytes begrenzten Passwörtern werden zusätzliche Zeichen nicht durch
  bcrypt-Trunkierung akzeptiert. Das Hashformat liegt im vorhandenen
  `passwordHash`-Feld; eine Schemaänderung oder Migration ist dafür nicht nötig.
- Nach Registrierung erfolgt die Weiterleitung zur Anmeldung mit Erfolgshinweis.
  Nach Passwort- oder OAuth-Login öffnet sich `/account`; dort ist Logout möglich.
  Die Kontoseite prüft ihre Session serverseitig. Die Startseite verlinkt die Zugänge.
- Bestehende `User` bleiben erhalten. `passwordHash`, `emailVerified` und `image`
  sind optional. OAuth-Konten und bestehende Nutzer brauchen kein Passwort.
  Es werden keine Company-Mitgliedschaften oder erhöhten Rollen angelegt.
- `Account`, `Session` und `VerificationToken` entsprechen dem Prisma-Adapter.
  Credentials benötigt bei Auth.js die **JWT-Sessionstrategie**. Auch OAuth nutzt
  deshalb verschlüsselte JWTs in HttpOnly-/SameSite=Lax-Cookies mit acht Stunden
  Laufzeit. Unter HTTPS und in Produktion sind Cookies zusätzlich Secure.
  `Account` speichert OAuth-Verknüpfungen; `Session` wird in dieser Strategie
  nicht befüllt. `VerificationToken` ist für spätere Verifizierungsflows vorbereitet.
- Auth.js schützt seine Endpunkte mit CSRF-Tokens und seine OAuth-Flows mit den
  jeweiligen Anbieterprüfungen. Formulare verwenden Next.js Server Actions mit
  Origin-Prüfung. Login-Ziele sind fest; Auth.js begrenzt Callback-URLs auf dieselbe
  Origin. Gelöschte Nutzer erhalten keine gültige Session mehr. Logout entfernt
  das Cookie; bereits kopierte JWTs sind dadurch nicht zentral widerrufen.
- Anmeldungen sind pro normalisierter E-Mail-Adresse auf zehn, Registrierungen
  auf fünf Versuche je festem 15-Minuten-Fenster begrenzt. `AuthRateLimit` speichert
  atomare Zähler mit SHA-256-Digest statt Klartextadresse in PostgreSQL, über alle
  App-Instanzen hinweg. Abgelaufene Einträge werden beim nächsten Versuch gelöscht.
  Dieser kontobezogene Schutz ersetzt keinen globalen/IP-Schutz am Reverse Proxy.
- Vorhandene Adressen werden zusätzlich ohne Beachtung der Groß-/Kleinschreibung
  gesucht. Mehrdeutige Legacy-Duplikate führen zur Ablehnung. Vor einer späteren
  Migration bestehende Adressen auf Leerzeichen und normalisierte Duplikate prüfen
  und kontrolliert bereinigen; diese Implementierung schreibt Bestandsdaten nicht um.
- Gleiche E-Mail-Adressen verknüpfen OAuth- und Passwortkonten **nicht automatisch**.
  Bei `OAuthAccountNotLinked` wird die bisherige Anmeldemethode verlangt. Ein
  vorhandenes OAuth-Konto kann durch erneute Registrierung kein Passwort erhalten.

E-Mail-Verifizierung per Versand, Passwort-Reset und eine Oberfläche zur bewussten
Kontoverknüpfung sind nicht Teil dieser Integration. Die bestehenden Event- und
Company-Routen sowie deren Berechtigungsregeln wurden nicht geändert; diese
Auth-Integration ersetzt keine unternehmensbezogene Autorisierung. Dafür muss
`auth()` an den jeweiligen Datenzugriffen mit einer Prüfung der Mitgliedschaft
und Rolle kombiniert werden.

## Prüfung

`npm test` prüft unter anderem Registrierung, Hashing, normalisierte und doppelte
Adressen, Validierung, Fehlerbehandlung sowie den echten Auth.js-HTTP-Ablauf mit
Datenbank-Doubles: Login, Session-Cookie, CSRF, Logout, Rate Limit, Redirects und
Löschung eines Nutzers. Die Tests verändern keine Datenbank. OAuth-Ende-zu-Ende-
Tests benötigen echte Anbieterzugänge und ein separat aktualisiertes DB-Schema.

Die Passworttests decken auch Ein-Zeichen-Passwörter, lange Unicode-Eingaben,
Unterschiede hinter Byte 72, Leerzeichen, Nullbytes und bestehende bcrypt-Hashes ab.

Prüfstand der ursprünglichen Auth-Integration: 90 Tests erfolgreich; ESLint und
`prisma validate` erfolgreich. HTTP-Smoke-Tests bestätigen die Formulare auf
`/login` und `/register`, den Session-Endpunkt und die Weiterleitung von `/account`
ohne Session. Der Produktionscode kompiliert, der vollständige Build/Typecheck
scheitert jedoch an bereits vorhandenen Baustellen:

- Die leeren `app/company/[id]/eventseries/page.tsx` und
  `app/company/[id]/venues/page.tsx` sind keine gültigen Seitenmodule.
- `lib/events/event-mutations.ts` liefert die inzwischen im vorhandenen Schema
  benötigten Felder `company`/`companyId` und `ticketPrice` nicht.
- Ein Booking-Testdatensatz in `tests/event-management.test.ts` entspricht noch
  nicht dem erweiterten vorhandenen Schema.

`npm audit` meldet außerdem 12 Befunde im bestehenden Abhängigkeitsbaum
(11 high, 1 critical), darunter die installierte Next.js-Version 16.3.5.
Ein Update dieser bestehenden Abhängigkeiten wurde nicht mit der Auth-Integration
vermengt. Vor einem produktiven Einsatz sind die Befunde zu bearbeiten.

Referenzen: [Auth.js Prisma-Adapter](https://authjs.dev/getting-started/adapters/prisma),
[Credentials](https://authjs.dev/getting-started/providers/credentials),
[Next.js/Auth.js](https://authjs.dev/reference/nextjs),
[OWASP: scrypt-Parameter und bcrypt-Eingabelimit](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
