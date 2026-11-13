# Mailversand

Bewertungseinladungen nach eingelöster Teilnahme nutzen ebenfalls die bestehende
Mail-Outbox und den Reconciliation-Job. Ablauf, Linkschutz und Deployment:
[Eventbewertungen](event-reviews.md).

`lib/mail/index.ts` stellt ein internes, serverseitiges Mailmodul bereit. Es erstellt
eine MIME-Nachricht und sendet sie je nach `MAIL_TRANSPORT` entweder über SMTP
(Nodemailer) oder Microsoft Graph. Es benötigt die Node.js-Runtime, keine Edge-Runtime.
Importieren allein baut keine Verbindung auf; fehlende Mailkonfiguration beeinflusst
andere Seiten nicht.

## STRATO einrichten

In der Strato-Umgebung `MAIL_TRANSPORT=smtp` setzen, die SMTP-Werte aus
`.env.example` übernehmen und `SMTP_PASSWORD` mit dem Passwort des Postfachs
`ticket@mausberg.net` füllen.
SMTP-Host ist `smtp.strato.de`, Port `465`, `SMTP_SECURE=true` (direktes TLS).
Benutzername und Absender sind `ticket@mausberg.net`. `MAIL_FROM_NAME` bestimmt
den angezeigten Absendernamen. Danach den Entwicklungsserver neu starten.

Next.js expandiert `$` in `.env`-Werten: ein wörtliches Dollarzeichen im Passwort
als `\$` schreiben. Keine Zugangsdaten committen oder mit `NEXT_PUBLIC_` benennen.
Für Docker dieselben Variablen in `.env.docker` setzen; dort Passwörter in einfachen
Anführungszeichen schreiben (Compose expandiert darin keine Dollarzeichen).
`compose.yaml` reicht die Werte an den App-Container weiter. Nach Änderungen den
App-Container mit der bestehenden Deployment-Konfiguration neu erstellen.

Quelle: [STRATO: E-Mailserver-Adressen und Ports](https://www.strato.de/faq/mail/e-mailserver-adressen-ports-ssl-tls/).

## Microsoft Graph für den Plattformserver

Für die Microsoft-Umgebung `MAIL_TRANSPORT=microsoft-graph` setzen. Der Server
verwendet OAuth 2.0 Client Credentials (App-only): Er ruft mit Tenant-ID,
Application Client ID und Client Secret ein App-Token ab, hält es bis kurz vor
Ablauf im Prozessspeicher und sendet als die Adresse in `MAIL_FROM_ADDRESS`.
Es gibt keinen interaktiven Microsoft-Login.

Beispiel für `.env.docker` auf dem Microsoft-Server:

```dotenv
MAIL_TRANSPORT=microsoft-graph
MS_GRAPH_TENANT_ID="<Directory (tenant) ID>"
MS_GRAPH_CLIENT_ID="<Application (client) ID>"
MS_GRAPH_CLIENT_SECRET="<Secret Value>"
MAIL_FROM_ADDRESS="ticket@event-yoga.com"
MAIL_FROM_NAME="Event Yoga"
MAIL_REPLY_TO="info@event-yoga.com"
IMAP_ARCHIVE_ENABLED=false
```

`MS_GRAPH_CLIENT_SECRET` braucht den **Secret Value**, nicht die Secret ID.
Die Secret ID und die App-Object-ID gehören nicht in diese Env-Konfiguration.
Der Absender muss exakt dem Exchange-Application-RBAC-Scope entsprechen
(`ticket@event-yoga.com`). Der Microsoft-Server legt Versandkopien automatisch
in „Gesendete Elemente“ dieses Postfachs ab; der separate IMAP-Archivpfad wird
für Graph nicht verwendet. Zugangsdaten nur in der geschützten Serverdatei
hinterlegen, nie in Git oder mit `NEXT_PUBLIC_`.

Auf Strato bleibt `MAIL_TRANSPORT=smtp`; dort bleiben SMTP und optional IMAP
wie bisher konfiguriert. Beide Umgebungen können dasselbe Image verwenden,
wenn jede ihre eigenen Env-Werte an den App-Container weiterreicht.

`verifyMailConnection()` ruft bei Graph ein App-Token ab, sendet aber keine
Testmail und prüft dadurch nicht die Exchange-Mailboxberechtigung. Ein erfolgreicher
Graph-Aufruf liefert `202 Accepted`: Exchange hat die Nachricht angenommen, was
noch keine bestätigte Zustellung im Empfängerpostfach bedeutet. Für einen
kontrollierten Versandtest vor Livebetrieb `MAIL_TEST_RECIPIENT` auf eine
Testadresse setzen.

## Im Servercode verwenden

Für Testzwecke `MAIL_TEST_RECIPIENT="test@example.com"` setzen: Alle über das
Modul versendeten Mails gehen ausschließlich an diese Adresse statt an den
ursprünglichen Empfänger. Der Footer nennt den ursprünglich vorgesehenen
Empfänger; der Betreff bleibt unverändert. Eine leere oder
nicht gesetzte Variable verwendet die echten Empfänger. Leerzeichen werden
entfernt; eine ungültige Testadresse blockiert den Versand, statt auf echte
Empfänger zurückzufallen. Nach Änderungen Server bzw. App-Container neu starten.

```ts
import { sendMail, verifyMailConnection } from "@/lib/mail";

// Optional: prüft SMTP-Login oder ruft bei Graph ein App-Token ab; es wird keine Nachricht versendet.
await verifyMailConnection();

const { messageId } = await sendMail({
  to: "empfaenger@example.com",
  subject: "Deine Buchung",
  text: "Vielen Dank für deine Buchung!",
  // html: "<p>Vielen Dank für deine Buchung!</p>", // optional
});
```

Empfänger ist genau eine E-Mail-Adresse, Text ist verpflichtend und HTML optional.
HTML muss aus vertrauenswürdigen Vorlagen stammen; dynamische Nutzerdaten müssen
vor dem Einfügen HTML-escaped werden. Der Absender kommt ausschließlich aus der
Serverkonfiguration. Aufrufende Actions müssen ihre Berechtigungen, Empfänger und
Rate-Limits prüfen. Es gibt bewusst keinen öffentlich aufrufbaren Mail-Endpunkt.

TLS und Zertifikatsprüfung sind verpflichtend. Bei `SMTP_SECURE=false` wird
STARTTLS erzwungen (für andere entsprechend konfigurierte SMTP-Anbieter).
Verbindungszeitlimits verhindern unbegrenzt hängende Requests. SMTP-Logging sowie
Datei- und URL-Zugriffe für Mailinhalte sind deaktiviert. Fehler werden ohne
SMTP-Antworten, Zugangsdaten oder Mailinhalte weitergegeben.

Die Rückgabe bestätigt die Annahme durch den ausgewählten Transport (SMTP-Annahme bzw. Graph 202 Accepted), nicht die Zustellung im Posteingang.
Der SMTP-Transport selbst wiederholt keine Zustellung. Ticketmails verwenden
jedoch eine dauerhafte gemeinsame Outbox für kostenlose und bezahlte Buchungen
sowie expliziten Neuversand. Tickets und initialer Auftrag entstehen atomar.
Die editierbare Vorlage liegt in `lib/mail/templates/booking-confirmation.ts`.
Neuversand liest gespeicherte Codes, legt einen eigenen idempotenten Auftrag an
und meldet nur „Versand beauftragt“. Auswahl, Berechtigungen, automatische Retries,
Worker-Sperren und Deployment beschreibt [Ticket-Outbox](ticket-outbox.md).
Tests mocken SMTP und versenden keine echten Nachrichten.

## Öffentliche Tickets

Neue Buchungsbestätigungen enthalten pro Platz einen eigenen Link. Die URL wird
aus `AUTH_URL` gebildet: In Produktion ist HTTPS zwingend, lokal ist
`http://localhost:3000` erlaubt. Speicherung, Verschlüsselung und Schlüsselrotation beschreibt
[Ticketcodes](ticket-codes.md); die Kontoansicht steht unter
[Meine Buchungen](account-bookings.md).

Die Links haben die Form `/tickets#TOKEN`. Der Fragmentteil gelangt nicht in
HTTP-Zugriffslogs oder Referer-Header. Die Ticketseite übermittelt ihn per POST-Body
an `/api/public-ticket`. Keine Request-Bodies für diesen Endpunkt in Proxy/APM
loggen und keine Analytics oder Fremdskripte auf der Ticketseite einbinden.
Der Link bleibt in Browserhistorie und Mail sichtbar: Wer ihn besitzt, kann das
Ticket sehen. Die Seite setzt no-referrer/noindex, die API liefert no-store.

Die API zeigt ausschließlich Ticketnummer, Status, Event, Beginn und Veranstaltungsort.
Ticket-, Buchungs- und Eventstornierungen sowie bereits erfolgter Check-in werden
berücksichtigt. Der Abruf verändert weder Ticket noch Booking.
Die Ticketseite erzeugt lokal im Browser einen QR-Code mit dem reinen Ticket-Token
(keine URL) über `qrcode.react`. Es wird kein externer QR-Dienst kontaktiert.
## Check-in

Unter `/account/scan` können angemeldete Nutzer Tickets per Kamera oder durch
manuelle Token-Eingabe prüfen. Der Profil-Link „Tickets scannen“ öffnet die Seite.
Kamerazugriff benötigt HTTPS (oder localhost), Browserfreigabe und eine verfügbare
Kamera. Die QR-Auswertung erfolgt lokal; nur der Token wird zur Prüfung gesendet.
Nach einem Scan und beim Verlassen der Seite wird die Kamera freigegeben.

Alle angemeldeten Nutzer mit Token sehen dieselben minimalen Ticketdaten wie auf
der öffentlichen Ticketseite. Im Kamera-Scanner einlösen dürfen zugeordnete Trainer, EventStaff
oder VenueStaff der aktuellen Event-Venue. Eine Company-Mitgliedschaft oder globale Adminrolle allein reicht im Scanner nicht.
Die Company-Ticketverwaltung verwendet dagegen zusätzlich Mitgliedschafts- und
Adminrechte (`lib/tickets/access.ts`).
Die Berechtigung wird bei jedem Aufruf aus der Datenbank gelesen.

Nur der Button „Einlösen“ setzt `Ticket.checkedInAt`. Stornierte Tickets,
stornierte Buchungen/Events und bereits eingelöste Tickets werden abgelehnt.
Eine serialisierbare Transaktion und ein bedingtes Update verhindern doppelten
Check-in. Bei unklarem Netzwerkfehler erneut scannen, um den aktuellen Status
zu prüfen. Pro angemeldetem User gelten 120 Prüf-/Einlöseanfragen pro Minute.

Ein atomarer DB-Zähler begrenzt alle Ticketabrufe zusammen auf 300 pro Minute,
auch über mehrere App-Instanzen hinweg. Es werden keine unzuverlässigen
Forwarded-IP-Header vertraut. Bei Überschreitung folgt HTTP 429 mit Retry-After;
bei Ausfall des Limiters wird kein Ticket ausgeliefert. Diese globale Grenze kann
auch legitime Besucher betreffen; für größeren Betrieb zusätzlich individuelle
IP-Limits am vertrauenswürdig konfigurierten Reverse Proxy vorsehen.
