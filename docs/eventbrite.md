# Eventbrite: Company mit bestehender Organisation verbinden

Implementiert ist ausschließlich die Organisationsverknüpfung. Event-Erstellung,
Event-Checkbox, Synchronisierung, Ticketklassen, Buchungsimporte und Webhooks sind
nicht Bestandteil dieser Änderung. Bestehende Adapter-Platzhalter bleiben unverändert.
Stripe bleibt unabhängig.

## Konfiguration vor dem Betrieb

Eine App in der [Eventbrite API-Key-Verwaltung](https://www.eventbrite.com/account-settings/apps)
registrieren. Eine gegebenenfalls erforderliche Freigabe für fremde Nutzer muss
vor dem Betrieb vorliegen; die Voraussetzungen mit Eventbrite klären.

Diese vier Variablen serverseitig zur Laufzeit setzen (Docker: `.env.docker`,
Weitergabe über `compose.yaml`, keine Build-Args oder NEXT_PUBLIC-Variablen):

- `EVENTBRITE_CLIENT_ID`: App Key der registrierten App.
- `EVENTBRITE_CLIENT_SECRET`: Client Secret dieser App.
- `EVENTBRITE_REDIRECT_URI`: `https://DEINE-DOMAIN/api/integrations/eventbrite/callback`.
- `EVENTBRITE_TOKEN_ENCRYPTION_KEY`: 32 zufällige Bytes als Standard-Base64.

Client ID, Secret und Redirect URI müssen zur gleichen Eventbrite-App gehören.
Die Redirect URI muss in Eventbrite und Deployment identisch sein. Für das
vorhandene Traefik-Deployment lautet sie:
`https://events.mausberg.net/api/integrations/eventbrite/callback`.
`AUTH_URL` muss dieselbe öffentliche HTTPS-Origin verwenden. Query, Fragment
und URL-Zugangsdaten sind unzulässig. Ausschließlich außerhalb des Produktionsmodus
ist für den Host `localhost` HTTP erlaubt. Für `npm run dev` kann lokal
`AUTH_URL=http://localhost:3000` zusammen mit
`EVENTBRITE_REDIRECT_URI=http://localhost:3000/api/integrations/eventbrite/callback`
verwendet werden. Diese Redirect URI muss auch in Eventbrite hinterlegt sein.
Andere Hosts und Produktionsbetrieb verlangen weiterhin HTTPS.
Die Route vergleicht Callback-Origin und Pfad mit der Konfiguration;
der Proxy muss die öffentliche URL korrekt weiterreichen. Ungeprüfte Header
werden nicht zur Konstruktion von Redirects verwendet.

Schlüssel erzeugen:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keinen AUTH_SECRET- oder Ticketschlüssel wiederverwenden. Auf allen Instanzen
denselben dedizierten Schlüssel nutzen und sicher sichern. Ein Schlüsselwechsel
erfordert vorherige Neuverschlüsselung oder Trennen und erneutes Verbinden.

**Es wurde keine Migration erzeugt oder ausgeführt. Vor Deployment eine
Prisma-Migration erstellen, prüfen und über den vorhandenen Deployment-Ablauf
ausrollen. Den Prisma-Client neu generieren.**

## Ablauf und Berechtigungen

Der Eventbrite-Bereich steht direkt auf `/company/[slug]/settings` unter dem
Stripe-Bereich. OAuth-Rückkehr und Verwaltungsaktionen führen auf diese Seite zurück.

Nur Company-Admins und Plattform-Admins gemäß bestehender Company-Autorisierung
haben Zugriff auf **Einstellungen → Eventbrite**. Company-User sehen weder den
Bereich noch den Status und dürfen keine Verwaltungsaktion ausführen. Seite,
Callback und sämtliche Actions prüfen serverseitig die vorhandenen Admin-Rechte.
Die Verbindung bleibt unabhängig von späteren Event-Funktionen im Hintergrund bestehen.

Der Admin startet OAuth, autorisiert die App bei Eventbrite und wählt danach eine
Organisation ausdrücklich aus. Auch eine einzelne Organisation muss bestätigt
werden. Der Admin benötigt in Eventbrite die notwendigen Verwaltungsrechte.
Bei erneutem OAuth bleiben die bisherige Organisation und das bisherige Token
unverändert, bis die neue Auswahl bestätigt und atomar gespeichert ist.

Eine Organisation ist global nur einer Company zugeordnet. Auch eine fehlerhafte
Verbindung reserviert ihre Organisation bis zum Trennen. „Verbindung prüfen“
prüft den Zugriff serverseitig; 401/403 oder verlorene Mitgliedschaft markieren
den Status als Fehler. Temporäre API-Fehler verändern die aktive Verbindung nicht.
Es gibt keine Hintergrundprüfung. Abgelaufene oder widerrufene Tokens erfordern
erneute Autorisierung; ein Refresh-Token-Flow wird nicht angenommen.

Trennen entfernt nur lokale Eventbrite-Zugangsdaten, Organisationszuordnung und
laufende Einrichtung dieser Company. Events, Bookings und andere Daten bleiben
erhalten. Die appweite Freigabe kann der Nutzer zusätzlich bei Eventbrite widerrufen;
das lokale Trennen widerruft sie nicht.

## Sicherheit und API-Grenzen

Der zufällige State liegt nur als SHA-256-Digest vor und ist an Company, Nutzer
und die konkrete Auth.js-Session gebunden. Atomare Konsumierung vor dem Codeaustausch
verhindert Replay. Einrichtung und Auswahl verfallen nach 15 Minuten. Neustart
invalidiert den alten Versuch; Trennen invalidiert auch laufende Callbacks.
Nach Provideraufrufen werden Admin-Rechte vor der Speicherung erneut geprüft.
Next.js Server Actions liefern die vorhandene CSRF-Prüfung für POST-Aktionen.
Tokens liegen AES-256-GCM-verschlüsselt und per AAD an die Company gebunden vor.
Die neuen Modelle sind nicht Teil der Audit-Payload-Policies; Tokens und Secrets
gelangen nicht in UI-Props, API-Antworten, Fehlertexte oder Anwendungslogs.

Abgelaufene `EventbriteOAuth`-Datensätze sind unbrauchbar und können betrieblich
anhand `expiresAt` gelöscht werden. Neustart ersetzt sie, Trennen entfernt sie.
HTTP-/Proxy-Zugriffslogs des Callbacks müssen Querystrings ausblenden, damit
OAuth-Codes nicht in Infrastruktur-Logs stehen.

Verwendet werden OAuth Authorize und der form-urlencodierte Token-POST bei
`https://www.eventbrite.com/oauth/authorize` und `/oauth/token` sowie ausschließlich
lesende Organisationsabfragen auf
`https://www.eventbriteapi.com/v3/users/me/organizations/` mit Bearer-Token.
Pagination folgt `has_more_items` und `continuation`, höchstens 100 Seiten;
bei Überschreitung wird keine unvollständige Auswahl angeboten.

Die Organisationsliste belegt Mitgliedschaft, garantiert aber keine bestimmten
Verwaltungsrechte für spätere Eventoperationen. Die öffentliche Referenz liefert
hier keinen verlässlich dokumentierten einzelnen Admin-Schalter. Deshalb werden
keine Rollenfelder oder OAuth-Scopes erfunden. Verwaltungsrechte vor dem Betrieb
in Eventbrite prüfen; spätere Eventoperationen brauchen eine eigene Rechteprüfung.

Offizielle Quellen, geprüft am 08.11.2026:
[OAuth-Code-Flow](https://www.eventbrite.com/platform/docs/app-oauth-flow),
[API-Referenz mit Authentifizierung, Pagination und Organisationen](https://www.eventbrite.com/platform/new/api),
[Organisationsmodell](https://www.eventbrite.com/platform/docs/organizations).

Manuelle Abnahme nach Migration: mehrere und einzelne Organisationen, doppelte
Zuordnung, Ablehnung, abgelaufener/replayter State, andere Session, entzogene
Admin-Rechte vor Callback/Auswahl, direkte Zugriffe als Company-User, Neustart
bei aktiver Verbindung, widerrufenes Token, API-Ausfall und Trennen prüfen.
Eine registrierte Eventbrite-App ist für diese OAuth-Abnahme erforderlich.
