# Plattformstatus

`/status/overview` ist eine öffentliche, serverseitige Momentaufnahme. Der Link
steht für globale Admins in der Navigation. Es werden keine User-Anzahlen,
Kontostände, Zugangsdaten oder ursprünglichen Fehlermeldungen veröffentlicht.

| Dienst | Prüfung | Aussage bei Erfolg / mögliche Einschränkung |
| --- | --- | --- |
| Datenbank | `user.count()` | Verbindung und User-Tabelle lesbar, auch bei null Usern. Kein Nachweis für Schreibrechte, alle Tabellen oder freie Kapazität. |
| Cloudinary | Authentifizierter Admin-API-Ping | API erreichbar und Zugang akzeptiert. Uploadrechte, Kontingent und CDN nicht geprüft. |
| Stripe | Plattform-Balance lesen, ohne Connected-Account-Header | Plattformzugriff erfolgreich, auch im Testmodus. Keine Kontostände ausgegeben; Zahlungen, Webhooks und Connected Accounts nicht geprüft. Ein eingeschränkter Key benötigt Leserechte für Balance. |
| SMTP | Nodemailer `verify()` | Verbindung, TLS und Login erfolgreich; keine Nachricht versendet. Absenderannahme und Zustellung nicht geprüft. |
| IMAP | Nur Vorhandensein der Archiv-Zugangsdaten, einschließlich STRATO-Fallback | Nicht geprüft, nicht konfiguriert oder explizit deaktiviert. Kein Login und kein Schreibtest. |
| Eventbrite | Lokale App-Konfiguration validieren | Nicht geprüft oder nicht konfiguriert. Keine Unternehmens-Tokens gelesen und keine OAuth-Verbindungen geprüft. |
| Google / GitHub | Vorhandensein der OAuth-Zugangsdaten | Nicht geprüft oder nicht konfiguriert. Ein vollständiger Login ist für eine Funktionsprüfung nötig. |

Kernchecks können **Erreichbar** (grün), **Langsam** (gelb, erfolgreicher Check ab
2 Sekunden), **Zeitüberschreitung** (gelb, Ergebnis unklar nach 8 Sekunden),
**Zugriff verweigert** (rot, erkannte Authentifizierungs-/Berechtigungsfehler),
**Fehler** (rot, sonstige fehlgeschlagene Prüfung einschließlich Rate-Limit) oder
**Nicht konfiguriert** (gelb) melden. Fehlende Konfiguration bedeutet nicht, dass
der Anbieter ausgefallen ist. Graue Zustände sind **Nicht geprüft** und
**Deaktiviert**. Insbesondere darf vorhandene Konfiguration nicht grün erscheinen.

Jede App-Instanz hält Ergebnisse 30 Sekunden im Speicher und fasst gleichzeitige
Prüfungen zusammen. Der Button liest innerhalb dieser Zeit denselben Prüfstand.
Kein Hintergrundmonitoring, keine Historie und keine automatische Wiederholung.
Ein allgemeines Zeitlimit begrenzt die Wartezeit der Anzeige; eine bereits
laufende Datenbankabfrage kann danach im Hintergrund noch enden. Cloudinary,
Stripe und SMTP haben zusätzlich eigene Transport-Zeitlimits.

Quellen:
- [Cloudinary Admin API – Ping](https://cloudinary.com/documentation/admin_api#ping)
- [Stripe – Retrieve balance](https://docs.stripe.com/api/balance/balance_retrieve)
- [Nodemailer – SMTP verification](https://nodemailer.com/smtp#verifying-the-configuration)
