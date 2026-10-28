# Meine Buchungen

`/account/bookings` zeigt alle dem angemeldeten Nutzer zugeordneten Buchungen,
einschließlich stornierter, abgelaufener und noch unbezahlter Buchungen.

- Kommende und laufende Events stehen zuerst, nach Beginn aufsteigend.
- Vergangene Events folgen nach Beginn absteigend. Maßgeblich ist das Eventende;
  fehlt es, wird der Beginn verwendet. Events mit Status `COMPLETED` sind vergangen.
- Ohne Termin steht die Buchung am Ende der kommenden Events.
- Dauer wird aus Beginn und Ende berechnet; alle Zeiten werden in Europe/Berlin angezeigt.
- „Stornieren“ öffnet das bestehende Formular zur Selbststornierung bzw. Anfrage.
  Die verbindliche Berechtigungs- und Fristprüfung bleibt in den Server Actions.

## Tickets im Konto

`/account/tickets/[ticketId]` prüft serverseitig die Anmeldung und die Zuordnung
`ticket.booking.userId`. Fremde und unbekannte Tickets liefern gleichermaßen 404.
Es werden keine gespeicherten Token-Hashes an den Client übertragen.

Jedes neue Ticket besitzt einen stabilen zufälligen Code. Sein Hash und sein
AES-256-GCM-Chiffrat werden bei der Erstellung gemeinsam gespeichert. Die
Kontoansicht entschlüsselt ihn erst nach Anmeldung und Eigentumsprüfung.
E-Mail-Link und Konto-QR verwenden denselben Wert, ohne 24-Stunden-Laufzeit.
Der frühere signierte Konto-Code wurde entfernt; der Scanner sucht ausschließlich
per SHA-256-Hash und prüft unverändert Status, Staff-/Trainer-Berechtigung und
atomaren Check-in. Der Besitz eines Codes erteilt keine Einlöseberechtigung.

Auf der Ticketseite kann der Eigentümer einen erneuten Versand der gültigen,
noch nicht eingelösten Tickets der bestätigten Buchung beauftragen. Der Empfänger
ist ausschließlich die gespeicherte Buchungsadresse. Die UI zeigt bei fehlender
Verfügbarkeit denselben Grund wie die Serverprüfung und meldet nach Einreihen
„Versand beauftragt“. Alle Ticketmails verwenden die dauerhafte gemeinsame
[Ticket-Outbox](ticket-outbox.md); SMTP-Fehler werden automatisch wiederholt.

## Gemeinsame Ticketdarstellung

Beide Zugänge verwenden `lib/tickets/presentation.ts` und
`components/ticket-card.tsx`. Das gemeinsame Anzeigemodell enthält keine Codes,
Hashes, Chiffrate oder personenbezogenen Buchungsdaten. Der öffentliche Zugang
verwendet weiterhin den Fragment-Link und seinen geschützten POST-Endpunkt.
Die Kontoansicht übergibt den entschlüsselten Wert separat an den QR-Renderer.
Bei stornierten oder eingelösten Tickets zeigt das Konto weiterhin keinen QR;
der Code bleibt gespeichert und unverändert. Die Statusanzeige bleibt gemeinsam.

Konfiguration, Testdatenbereinigung, Migration und Schlüsselrotation:
[Stabile Ticketcodes](ticket-codes.md). Apple Wallet ist derzeit nicht implementiert.
