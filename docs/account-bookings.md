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

Bestehende E-Mail-Tickets speichern nur einen Token-Hash; ihre Links lassen sich
nicht wiederherstellen. Die Kontoansicht erzeugt daher einen separaten, mit
`AUTH_SECRET` signierten QR-Code mit Zweckbindung `account-ticket` und 24 Stunden
Gültigkeit. Nach Ablauf muss die Seite neu geladen werden. Der Ablaufzeitpunkt
steht unter dem QR-Code. Eine Rotation des Secrets macht diese Codes ungültig.
Die ursprünglichen E-Mail-Tickets bleiben unverändert gültig.

Der vorhandene Scanner akzeptiert beide Formate und verwendet für beide dieselben
aktuellen Ticketstatus-, Staff-/Trainer-Berechtigungs- und atomaren Einlöseprüfungen.
Es werden keine zusätzlichen Tickets oder Datenbankfelder angelegt.
