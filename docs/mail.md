# Mailversand

`lib/mail/index.ts` stellt ein internes, serverseitiges Nodemailer-Modul bereit.
Es benötigt die Node.js-Runtime, keine Edge-Runtime. Importieren allein baut keine
Verbindung auf; fehlende SMTP-Konfiguration beeinflusst andere Seiten nicht.

## STRATO einrichten

Die SMTP-Werte aus `.env.example` in die lokale `.env` übernehmen und
`SMTP_PASSWORD` mit dem Passwort des Postfachs `ticket@mausberg.net` füllen.
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

## Im Servercode verwenden

Für Testzwecke `MAIL_TEST_RECIPIENT="test@example.com"` setzen: Alle über das
Modul versendeten Mails gehen ausschließlich an diese Adresse statt an den
ursprünglichen Empfänger. Inhalt und Betreff bleiben unverändert. Eine leere oder
nicht gesetzte Variable verwendet die echten Empfänger. Leerzeichen werden
entfernt; eine ungültige Testadresse blockiert den Versand, statt auf echte
Empfänger zurückzufallen. Nach Änderungen Server bzw. App-Container neu starten.

```ts
import { sendMail, verifyMailConnection } from "@/lib/mail";

// Optional: prüft TLS-Verbindung und Login, versendet keine Nachricht.
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

Die Rückgabe bestätigt die Annahme durch SMTP, nicht die Zustellung im Posteingang.
Es gibt keine automatischen Retries: Bei einem Verbindungsabbruch kann die Mail
bereits angenommen worden sein. Ein späterer automatischer Buchungsversand braucht
eine eigene Zustellstrategie (z. B. Outbox), außerhalb der Buchungstransaktion.

Neue öffentliche Buchungen versenden nach dem Commit eine Bestätigung an die
Buchungsadresse (bzw. `MAIL_TEST_RECIPIENT`). Die editierbare Vorlage liegt in
`lib/mail/templates/booking-confirmation.ts`: Betreff und Text dort bearbeiten;
HTML wird daraus automatisch mit escapten Werten erzeugt.
Wiederholtes Absenden derselben Buchung versendet keine weitere Mail.
Bei Versandfehlern bleibt die Buchung erfolgreich; die Buchungsseite zeigt einen
Hinweis an. Der Versand ist derzeit ein einmaliger Versuch ohne persistente
Outbox: Ein Prozessabbruch nach dem Commit kann die Bestätigung verhindern.
Es gibt noch keinen automatischen Wiederholungsversand oder Verifizierungsversand.
Bestehende Ticket-Hashes erlauben keine Rekonstruktion der Klartext-Tokens;
Alte Tickets erhalten daher keine nachträglich rekonstruierten Links.
Tests mocken SMTP und versenden keine echten Nachrichten.

## Öffentliche Tickets

Neue Buchungsbestätigungen enthalten pro Platz einen eigenen Link. Die URL wird
aus `AUTH_URL` gebildet: In Produktion ist HTTPS zwingend, lokal ist
`http://localhost:3000` erlaubt. Die Klartext-Tokens bleiben nur während der
Buchung und Mailerstellung im Arbeitsspeicher, in der Datenbank stehen nur Hashes.

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
Ein geschützter Check-in ist weiterhin nicht implementiert.

Ein atomarer DB-Zähler begrenzt alle Ticketabrufe zusammen auf 300 pro Minute,
auch über mehrere App-Instanzen hinweg. Es werden keine unzuverlässigen
Forwarded-IP-Header vertraut. Bei Überschreitung folgt HTTP 429 mit Retry-After;
bei Ausfall des Limiters wird kein Ticket ausgeliefert. Diese globale Grenze kann
auch legitime Besucher betreffen; für größeren Betrieb zusätzlich individuelle
IP-Limits am vertrauenswürdig konfigurierten Reverse Proxy vorsehen.
