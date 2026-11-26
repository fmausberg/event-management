# Eventbrite: Company mit bestehender Organisation verbinden

Implementiert sind die Organisationsverknüpfung, die optionale Veröffentlichung
von Company-Events mit einer Ticketklasse zum gespeicherten Bruttopreis und ein
manueller Buchungsimport pro Event. Laufender Kapazitätsabgleich, spätere
Event-Änderungen/Absagen und Webhooks sind weiterhin nicht implementiert. Die allgemeinen Adapter-Platzhalter
bleiben unverändert. Stripe bleibt unabhängig.

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

Optional: `EVENTBRITE_LISTED=true` oder `EVENTBRITE_LISTED=false` steuert das API-Feld
`event.listed` für neu angelegte Eventbrite-Events. Ohne Variable gilt weiterhin
`true`. Erlaubt sind ausschließlich diese beiden kleingeschriebenen Werte, ohne
zusätzliche Leerzeichen; leere oder andere Werte brechen die Übertragung mit einer
verständlichen Konfigurationsfehlermeldung ab, bevor entfernte Ressourcen erstellt
werden. Die Prüfung erfolgt bei Bedarf serverseitig zur Laufzeit, ohne
`NEXT_PUBLIC_`, Build-Argument oder Browser-Prop.

In `/opt/docker/event-management/.env.docker` setzen:

- **Strato-Testserver:** `EVENTBRITE_LISTED=false`
- **IONOS-Produktivserver:** `EVENTBRITE_LISTED=true`

`listed=false` bedeutet: Das Event wird auf Eventbrite angelegt und veröffentlicht,
aber nicht öffentlich gelistet oder über die Eventbrite-Suche auffindbar. Es bleibt
über die direkte Event-URL erreichbar, sofern die Eventbrite-Privatsphäreinstellungen
nichts anderes festlegen. **Dies ist keine Sandbox** und verhindert weder die
Erstellung noch die Veröffentlichung auf Eventbrite.

Eine geänderte Einstellung aktualisiert vorhandene Events nicht automatisch.
Nur neue Eventbrite-Events und Wiederholungsversuche, bei denen das entfernte Event
noch ein Entwurf ist, verwenden den aktuellen Wert. Bereits live geschaltete oder
gestartete Events werden bei einem Retry nur als erfolgreich erkannt, ohne
Schreibaufrufe oder erneute Erstellung. Compose reicht die Variable explizit an
`app` weiter und verwendet bei fehlendem Eintrag `true`; ein ausdrücklich leerer
Wert bleibt zur Validierung erhalten. `migrate` benötigt diese Variable nicht.
Umgebungsänderungen werden beim regulären Neuerstellen des App-Containers wirksam.

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

Die Verbindung benötigt die bestehende Migration
`20261108164814_add_eventbrite_connection`. Die Event-Veröffentlichung ergänzt
`20261126160109_eventbrite_event_publication` (Opt-in am Event und dauerhafter
Veröffentlichungsauftrag). Die neue Migration wurde nicht auf eine Datenbank
angewendet. Beim Deployment über den bestehenden Ablauf mit `prisma migrate deploy`
ausrollen; Docker verwendet dafür den Migrationscontainer. Den Prisma-Client beim
Build neu generieren. Niemals `migrate dev` oder `db push` gegen Produktion verwenden.

Der manuelle Buchungsimport benötigt zusätzlich
`20261126161000_eventbrite_manual_booking_import`. Sie ergänzt auf `PlatformEvent`
den letzten erfolgreichen Import, eine bereinigte Fehlermeldung und eine zeitlich
begrenzte Importsperre. Diese Migration wurde ebenfalls nicht auf eine Datenbank
angewendet; über denselben Deployment-Ablauf ausrollen und den Client neu generieren.

## Events veröffentlichen

Das Event-Formular enthält **„Bei Veröffentlichung auch auf Eventbrite posten“**.
Die Option ist standardmäßig aus und nur mit einer verbundenen Organisation
auswählbar. Sie bleibt am Entwurf gespeichert und gilt bei Mehrfacherstellung für
alle ausgewählten Termine. Die vorhandenen Company-Mitglieder mit Event-Verwaltungsrecht
dürfen die Option verwenden; OAuth und Verbindungsverwaltung bleiben Admin-Aufgaben.

Der bestehende zentrale Veröffentlichungs-Hook legt den Auftrag in derselben
Datenbanktransaktion an, sobald der endgültige Status `PUBLISHED` erreicht ist.
Offene Trainer-/Ortsfreigaben lösen noch keine Übertragung aus. Auch ohne
Benachrichtigungsempfänger wird der Auftrag gespeichert. Ein Auftrag bleibt an die
damals verbundene Organisations-ID gebunden; ein späterer Organisationswechsel
leitet ihn nicht auf eine andere Organisation um.

Nach dem Speichern werden bis zu fünf wartende Aufträge der Company bearbeitet.
Der bestehende geschützte Scheduler `POST /api/payments/reconcile` bearbeitet ebenfalls
bis zu fünf wartende Aufträge pro Aufruf. Er muss regelmäßig laufen, insbesondere
für Veröffentlichungen nach späteren Freigaben und größere Mehrfacherstellungen.

Übertragen werden Name, Kurzbeschreibung (Eventbrite-Summary maximal 140 Zeichen),
Beschreibung über Structured Content, Beginn/Ende mit Zeitzone `Europe/Berlin`,
Ort samt Adresse, EUR und Teilnehmerzahl. Das Titelbild wird noch nicht übertragen.
Eventbrite muss für die Organisation einen nutzbaren Standard-Veranstalter und
bei kostenpflichtigen Tickets die erforderliche Zahlungskonfiguration bereitstellen.
Fehlende Provider-Voraussetzungen erscheinen als Übertragungsfehler am lokalen Event.

Die Ticketklasse **„Teilnahme“** erhält den unveränderten Bruttopreis als ganzzahlige
Centzahl. Kostenpflichtige Tickets verwenden `include_fee: true`: Eventbrite-Gebühren
reduzieren die Veranstalterauszahlung. Bei 0 EUR wird eine kostenlose Ticketklasse
angelegt. Vor Veröffentlichung wird der von Eventbrite gelieferte Preis geprüft.
Unlesbare Preise, abweichende Währung/Beträge, fehlende Gebührenübernahme oder
nicht-null Steuerbeträge sperren die Veröffentlichung. Eventbrite-Steuern werden
nicht automatisch aus der lokalen Steuerkonfiguration eingerichtet; zusätzliche
Aufschläge müssen dort geklärt werden. Das entfernte Event bleibt dann als Entwurf
erhalten, statt unbemerkt einen höheren Käuferpreis anzubieten.

**Es gibt noch kein gemeinsames Platzkontingent.** Eventbrite erhält die volle
Teilnehmerzahl unabhängig von lokalen Buchungen. Beide Plattformen können dieselben
Plätze verkaufen; Überbuchungen sind möglich. Eventbrite-Buchungen können manuell
importiert werden; Zahlungen und Ticketcodes werden nicht importiert. Kontingente daher bis zur
Implementierung des Abgleichs separat in Eventbrite verwalten. Lokale spätere
Änderungen und Absagen werden ebenfalls nicht übertragen.

## Buchungen per Knopfdruck importieren

Unter **Event → Buchungen** und auf der separaten Buchungsseite erscheint bei einem
zugeordneten Event der Button **„Eventbrite-Buchungen synchronisieren“**. Er ist für
die vorhandenen berechtigten Company-Mitglieder und Plattform-Admins verfügbar.
Genau eine Eventbrite-Zuordnung und eine gültige Verbindung zur tatsächlichen
Organisation des entfernten Events sind erforderlich. Die Zuordnung darf für den
allgemeinen Kapazitäts-Sync weiterhin `DISABLED` sein; dies sperrt den manuellen Import nicht.

Jeder Klick liest alle Seiten der Bestellungen ohne `status`-Filter und die
Teilnehmer dieses Events. Der zuvor verwendete Filter `status=both` wird von der
eingesetzten Eventbrite-API mit `ARGUMENTS_ERROR` abgewiesen, obwohl er in der
öffentlichen Dokumentation aufgeführt ist.

Da die Standardliste inaktive Bestellungen auslassen kann, werden bereits lokal
bestätigte Bestellungen, die darin fehlen, einzeln über
`GET /orders/{order_id}/?expand=attendees` abgeglichen. Das gilt auch für
Teilnehmer mit fehlender Bestellung in der Liste und für platzierte Bestellungen
ohne Teilnehmerdaten. Damit bleiben bekannte Stornierungen und Teilstornierungen
berücksichtigt. Nicht abrufbare Bestellungen werden nicht als storniert interpretiert;
der gesamte Import bricht dann ab. Einzelabrufe unterliegen demselben Zeitlimit
und werden auf das Limit von 5.000 Datensätzen angerechnet. Bereits stornierte,
nicht mehr gelistete lokale Bestellungen bleiben erhalten. Eine vollständige
Historie unbekannter, auch in der Teilnehmerliste fehlender inaktiver Bestellungen
wird durch die Standardliste nicht garantiert.

Die Eventbrite-API
liefert einen Teilnehmerdatensatz pro Ticket. Eine lokale Buchung entspricht
einer Eventbrite-Bestellung, identifiziert durch `(EVENTBRITE, order.id)`.
Übernommen werden Käufername, E-Mail, ursprüngliches Bestelldatum und die Zahl
noch gültiger Tickets. Teilstornierungen/Erstattungen reduzieren diese Zahl; bei
vollständiger Stornierung bleibt die Buchung als `CANCELLED` mit ihrer Gesamtmenge erhalten.
Offene, gestartete und abgebrochene Checkouts werden übersprungen. Unbezahlte oder
unbekannte Teilnehmerzustände innerhalb einer platzierten Bestellung sperren den Import.
Wechselt eine bereits importierte Bestellung zurück in einen offenen Zustand,
wird ebenfalls abgebrochen statt ein veralteter bestätigter Stand als Erfolg gemeldet.
Explizit stornierte/gelöschte Bestellungen ohne Teilnehmerdaten stornieren bekannte
lokale Buchungen mit unveränderter Menge; unbekannte werden mangels Menge übersprungen.
Gastlisten ohne Bestellzuordnung werden nicht als Buchungen importiert.

Erst nach vollständig gelesenen und validierten Daten erfolgt eine gemeinsame
serialisierbare Datenbanktransaktion. Wiederholte Klicks aktualisieren bestehende
Buchungen und erzeugen keine Duplikate. Ein fehlender Datensatz allein wird nicht
als Stornierung interpretiert. Lokale Änderungen an externen Buchungen können beim
nächsten Import überschrieben, lokal gelöschte Buchungen wieder angelegt werden.
Zahlungs-, Preis-, Gutschein-, lokale Ticket- und aktive Stornierungshistorie wird
nicht überschrieben; ein solcher Konflikt bricht den gesamten Import ab.

Der Import erzeugt keine lokalen Tickets, Benutzerzuordnungen, Zahlungen,
Kundenmails oder Company-Buchungsbenachrichtigungen. Eventbrite-Geldbeträge werden
noch nicht in die lokale Umsatzübersicht übernommen; die Buchung weist darauf hin.
Der vorhandene Eventbrite-Ticketcode bleibt bei Eventbrite und ist dadurch nicht
automatisch mit unserem Scanner verwendbar.

Die UI zeigt die Zahlen neu/aktualisiert/unverändert/übersprungen, den letzten
erfolgreichen Zeitpunkt und Fehler. Bei Fehlern bleibt der letzte erfolgreiche
Buchungsstand erhalten. Bei HTTP-Fehlern werden Anfrageart, HTTP-Status und ein
formal geprüfter Eventbrite-Fehlercode angezeigt; soweit erkennbar auch betroffene
bekannte Parameternamen. Ungefilterte Providertexte und Parameterwerte werden
nicht angezeigt oder gespeichert. HTTP 400 allein belegt weder einen leeren
Event noch einen bestimmten ungültigen Filter.
Ein atomarer Claim verhindert parallele Importe; nach
einem Prozessabbruch kann der nächste bewusste Klick die Sperre nach fünf Minuten
übernehmen. Provideraufrufe sind auf 15 Sekunden pro Anfrage, insgesamt 60 Sekunden,
100 Seiten und 5.000 Datensätze pro Liste begrenzt; Überschreitung führt zum Abbruch
statt zu einem unvollständigen Import. Es gibt keinen automatischen Import oder Webhook.

Importierte bestätigte Plätze gehen sofort in die lokale Kapazitätsberechnung ein,
auch wenn das Event damit überbelegt ist. Es wird kein Bestand zurück an Eventbrite
geschrieben. Zwischen zwei Klicks können die lokalen Zahlen deshalb veraltet sein.

Abnahme: Erstimport, unveränderte Wiederholung, neue Bestellung, Käuferänderung,
Teil-/Vollstornierung, fehlgeschlagene Folgeseite, paralleler Klick, widerrufene
Leserechte und eine ersetzte Organisationsverbindung prüfen. API-Vertrag:
[Orders und Teilnehmer](https://www.eventbrite.com/platform/new/api),
[offizieller API Blueprint](https://www.eventbrite.com/platform/new/docs/eventbrite-api-v3-public.apib).

## Status, Wiederholung und Duplikatschutz

Die Event-Detailseite zeigt Auftrag, Fehler und die gespeicherte Eventbrite-ID.
Sobald Eventbrite die Erstellung bestätigt, werden ID und `PlatformEvent`-Zuordnung
atomar gespeichert, bevor Tickets/Veröffentlichung folgen. Die Zuordnung bleibt
`DISABLED` für den allgemeinen Kapazitäts-Sync, dessen Adapter noch ein Platzhalter ist.

Ein atomarer Claim verhindert parallele Worker. Bei eindeutigen Fehlern ist
**„Übertragung erneut versuchen“** verfügbar. Dabei werden gespeicherte Event- und
Ticket-IDs wiederverwendet. Ein bereits live geschaltetes Event wird als erfolgreich
erkannt, ohne es erneut anzulegen. Fehler bei externen Aufrufen machen die lokale
Veröffentlichung nicht rückgängig.

Vor nicht-idempotenten Create-Aufrufen wird `UNCERTAIN` gespeichert. Bei Timeout,
Serverfehler oder fehlgeschlagener Speicherung der Antwort-ID bleibt der Auftrag
gesperrt, damit ein erneuter Versuch keine Duplikate erzeugt. Unterbrochene
`PROCESSING`-Aufträge werden nach zehn Minuten ebenfalls gesperrt. Ein
Plattformadministrator muss dann die Organisation und vorhandenen Ressourcen bei
Eventbrite prüfen und die IDs mit `EventbritePublication` und `PlatformEvent`
abgleichen. Einen solchen Auftrag nicht ungeprüft auf `PENDING` zurücksetzen.
Es gibt dafür bewusst keinen automatischen Reset und keine Endnutzer-Reparaturaktion.

Nach Anlage des Auftrags bleibt die Checkbox gesperrt; das lokale Event kann mit
einem Auftrag nicht gelöscht werden. Das Trennen der Verbindung entfernt keine
Eventbrite-Events und keine bereits gespeicherten Veröffentlichungsaufträge.

Abnahme vor dem Einsatz: Entwurf mit Opt-in, Freigabe durch Trainer/Ort,
kostenloses und bezahltes Event, Bruttopreis/Gebühren im Eventbrite-Checkout,
fehlende Zahlungs-/Veranstaltereinstellungen, Preisabweichung/Steueraufschlag,
Mehrfacherstellung, Wiederholung nach Fehler, Organisationswechsel und
Verbindungsabbruch nach erfolgreichem externem Create prüfen.

API-Vertrag: [offizieller API Blueprint](https://www.eventbrite.com/platform/new/docs/eventbrite-api-v3-public.apib)
(Event Create, Ticket Class Create mit `capacity` statt des veralteten `quantity_total`,
Structured Content und Publish; geprüft am 26.11.2026).

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

Für die Verbindungsverwaltung verwendet werden OAuth Authorize und der form-urlencodierte Token-POST bei
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
