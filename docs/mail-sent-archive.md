# Versandkopien im STRATO-Postfach

Alle Versandstellen (Buchungsbestätigung, Zahlungsbestätigung, Verifizierung und
Zuordnungen) verwenden `lib/mail/index.ts`. Nodemailer erzeugt einmal eine
RFC-822/MIME-Nachricht. Dieselben Bytes werden per SMTP versendet und danach mit
ImapFlow per IMAP APPEND als gelesen (`\Seen`) im Gesendet-Ordner gespeichert.
Message-ID, Empfänger, Text, HTML, Footer und Anhänge bleiben identisch.
Es werden keine vorhandenen Nachrichten nachträglich archiviert.

## Konfiguration

| Variable | Wert / Bedeutung |
| --- | --- |
| `IMAP_ARCHIVE_ENABLED` | Standard `true`; `false` deaktiviert die Archivierung ausdrücklich. |
| `IMAP_HOST` | `imap.strato.de` |
| `IMAP_PORT` | `993`, ausschließlich implizites TLS mit Zertifikatsprüfung und mindestens TLS 1.2 |
| `IMAP_USER` | Vollständige Postfachadresse, dasselbe Postfach wie beim SMTP-Versand |
| `IMAP_PASSWORD` | Passwort dieses Postfachs, nicht das STRATO-Kundenlogin |
| `IMAP_SENT_FOLDER` | Normalerweise leer; bei Bedarf exakter vorhandener IMAP-Pfad des Gesendet-Ordners |

Sind **beide** IMAP-Zugangsdaten leer und die Hosts exakt `smtp.strato.de` und
`imap.strato.de`, werden `SMTP_USER` und `SMTP_PASSWORD` wiederverwendet. Ein
abweichender `MAIL_FROM_ADDRESS` wird nicht als IMAP-Benutzer verwendet.
Bei anderen Hosts oder expliziten IMAP-Zugangsdaten müssen beide Werte gesetzt sein.
Keine Passwörter in Git einchecken. Docker Compose übernimmt die Variablen aus der
Deployment-Konfiguration; nach Änderungen den App-Container neu erstellen.

Der Server muss ausgehende TLS-Verbindungen zu STRATO auf Port 993 erlauben.
Bei `MAIL_TEST_RECIPIENT` wird die tatsächlich an die Testadresse versendete Mail
archiviert; der Footer nennt weiterhin den ursprünglich vorgesehenen Empfänger.

## Ordner und Fehler

Die IMAP-Mailboxliste wird vor jedem APPEND abgefragt. Der als `\Sent` erkannte
Ordner wird bevorzugt. Falls keine solche Kennzeichnung vorhanden ist, werden
eindeutige bestehende Ordner mit Namen `Sent`, `Gesendet`, `Sent Items` oder
`Sent Messages` verwendet. Nicht auswählbare Ordner sind ausgeschlossen.
`IMAP_SENT_FOLDER` kann bei Mehrdeutigkeit einen exakten vorhandenen Pfad vorgeben.
Es wird niemals ein Ordner angelegt. Falls kein Ziel gefunden wird, im STRATO-Webmail
den dort vorgesehenen Gesendet-Ordner prüfen und gegebenenfalls dessen IMAP-Pfad
konfigurieren. Der Zielordner wird für das jeweils konfigurierte Postfach dynamisch ermittelt.

Ein Archivierungsfehler wird separat mit `[mail:archive]` protokolliert, ohne
Serverantworten, Passwörter, Empfänger oder Mailinhalt. Ein erfolgreicher Versand
bleibt erfolgreich: keine erneute Zustellung und kein Retry durch die Zahlungslogik.
Es gibt aktuell keinen automatischen Archivierungs-Retry; bei Störungen kann eine
Gesendet-Kopie fehlen. Die Verbindung wird auch bei Fehlern geschlossen.

Anhänge können zentral als `attachments` mit `filename`, `content` (Buffer oder
String), optional `contentType`, `encoding` und `cid` übergeben werden. Datei- und
URL-Zugriffe sind deaktiviert. Die vorhandene Buchungs-/Ticketlogik bleibt unverändert.

## Quellen

- [STRATO: Serveradressen und TLS-Ports](https://www.strato.de/faq/mail/e-mailserver-adressen-ports-ssl-tls/)
- [STRATO: IMAP und XLIST](https://www.strato.de/faq/mail/was-ist-imap-und-wie-kann-ich-es-nutzen/)
- [Nodemailer: MailComposer](https://nodemailer.com/extras/mailcomposer)
- [ImapFlow: Mailbox-Verwaltung](https://imapflow.com/docs/guides/mailbox-management/)
