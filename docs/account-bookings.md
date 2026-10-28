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

## Gemeinsame Ticketdarstellung

Beide Zugänge verwenden `lib/tickets/presentation.ts`: eine gemeinsame Auswahl
der Anzeigefelder und `toTicketViewModel` für Status, UTC-Zeitstempel und Adresse.
Der öffentliche POST-Endpunkt prüft weiterhin den E-Mail-Token per Hash; erst
danach wird das Anzeigemodell erstellt. `getMyTicket` prüft weiterhin Anmeldung
und Buchungszugehörigkeit und liefert zusätzlich die nur im Konto angezeigte
Buchungsnummer. Personenbezogene Buchungsdaten und Token-Hashes gehören nicht
zum gemeinsamen Anzeigemodell.

`components/ticket-card.tsx` rendert dieses Modell in beiden Zugängen. Der
öffentliche Client lädt es per POST; die Kontoseite erhält es serverseitig.
Die Karte erhält den jeweiligen QR-Wert als Eingabe und erzeugt keine Tokens.
Nur der Konto-Code enthält eine Ablaufanzeige. Öffentliche Codes bleiben auch
bei stornierten/eingelösten Tickets sichtbar; im Konto wird dann weiterhin kein
Code erzeugt. Die Statusanzeige ist identisch: Stornierung hat Vorrang, danach
Einlösung, danach bestätigte Buchung. Unbestätigte/abgelaufene Buchungen werden
in beiden Ansichten als „Nicht gültig“ angezeigt. Ort und Adresse sowie
Einlösezeitpunkt inklusive Sekunden werden einheitlich dargestellt.

Scanner, Tokenverfahren, Zugriffsrechte und Check-in-Schreiboperationen wurden
hierfür nicht geändert. Die gemeinsame Darstellung erteilt keine Einlöseberechtigung.

Für einen späteren gemeinsamen Ticketcode bleiben offen: verschlüsselt
gespeicherter Zufallstoken oder reproduzierbarer signierter Code, Laufzeit,
gezielter Widerruf und Schlüsselrotation sowie der Übergang für bestehende
E-Mail-Links. Wallet-Integration und E-Mail-Outbox sind kein Teil dieses Schritts.
