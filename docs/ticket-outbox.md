# Gemeinsamer Ticket-Mailversand

Alle Ticketmails laufen über `TicketMail`: initiale kostenlose Buchungen,
Stripe-Bestätigungen sowie expliziter Neuversand im Konto und in der
Company-Buchungsübersicht. `lib/tickets/outbox.ts` ist der gemeinsame Worker;
`lib/tickets/resend.ts` prüft und beauftragt beide Neuversandwege.

## Berechtigungen und Auswahl

- Company-Neuversand verlangt eine aktive COMPANY_USER-/COMPANY_ADMIN-Mitgliedschaft
  in der Company des Events. Eine globale Adminrolle allein genügt hierfür nicht.
  Buchungs-ID, Event-ID und Company-Slug werden gemeinsam eingeschränkt; die
  Mitgliedschaft wird innerhalb der serialisierbaren Versandtransaktion geprüft.
- Eigentümerzugriff ist auf `booking.userId` und das angeforderte Ticket begrenzt.
- Beide Wege verlangen CONFIRMED, ein nicht storniertes Event, eine gültige
  gespeicherte `booking.customerEmail` und mindestens ein Ticket mit
  `status = VALID` und `checkedInAt = null`.
- Nur diese Tickets werden ausgewählt, in Ticketnummer-Reihenfolge. Der Inhalt
  wird beim Einreihen verschlüsselt festgehalten. Spätere Statusänderungen ändern
  den Auftrag nicht; beim Öffnen/Einlösen gelten stets die aktuellen Ticketdaten.
- Der Empfänger kommt ausschließlich aus der Buchung, niemals aus FormData oder
  dem als Anzeigefallback verwendeten Benutzerprofil. Es gibt keine Aktion in
  der Company-Ticketübersicht.

`mail-policy.ts` und dieselbe Ticketfilterdefinition bestimmen sowohl
Frontend-Verfügbarkeit/Begründung als auch die serverseitige Entscheidung.
Auch auf einer bereits eingelösten eigenen Ticketseite kann Neuversand verfügbar
sein, wenn dieselbe Buchung noch andere gültige, nicht eingelöste Tickets enthält.
Die UI meldet **Versand beauftragt**, nicht erfolgreiche Zustellung.

## Idempotenz, Limits und Audit

Initiale Aufträge haben den eindeutigen Schlüssel `initial:<bookingId>`. Tickets,
Hash/Chiffrat und Auftrag werden in derselben Datenbanktransaktion angelegt.
Wiederholte Buchungsrequests und Stripe-Webhooks erzeugen keine zweite Bestätigung.

Jeder explizite Neuversand erhält eine UUID vom Formular. Ein Auftrag ist eindeutig
pro Nutzer, Buchung und UUID. Die UUID bleibt bei Doppelklicks, Netzwerkfehlern und
Wiederholungen gleich. Erst „Weiteren Versand vorbereiten“ startet einen neuen
bewussten Versand. Auch bereits versendete/gesperrte Aufträge werden bei gleichem
Request nur wiedererkannt, nie überschrieben oder zurückgesetzt. Neue Tabs bzw.
neu geladene Formulare sind neue Absichten; dafür gelten die Limits.

Maximal fünf neue Aufträge pro Auslöser und fünf pro Buchung in einem festen
15-Minuten-Fenster. Beide Zähler, Status-/Berechtigungsprüfung und Auftrag werden
serialisierbar verarbeitet. Deduplizierte Wiederholungen verbrauchen kein Limit.
Konflikte werden bis zu dreimal mit unveränderter Request-ID versucht.

`requestedById`, `bookingId`, `requestKey` und `createdAt` bleiben als Auditdaten
am Auftrag. Logs enthalten nur Nutzer-, Buchungs- und Auftrags-ID, keine Codes,
Empfänger, Mailinhalte oder SMTP-Fehlerdetails. Beim Löschen eines Nutzers wird
requestedById null; seine ursprüngliche ID bleibt im unveränderten Request-Key.

## Worker und Wiederholungen

`POST /api/payments/reconcile` mit `Authorization: Bearer <PAYMENTS_CRON_SECRET>`
muss mindestens einmal pro Minute laufen, **auch bei ausschließlich kostenlosen
Events**. Er bearbeitet bis zu 50 fällige Ticketmails als Nachbearbeitung bei
Versandfehlern oder Prozessabbrüchen. Kostenlose Buchungen versuchen den Versand
des initialen Auftrags sofort nach erfolgreichem Commit. Ein Versandfehler lässt
die Buchung erfolgreich und den Auftrag für einen späteren Cron-Versuch bestehen.
Wiederholte Buchungsrequests erzeugen keinen weiteren Versand. Stripe-Webhooks
und die Zahlungsrückkehrseite können ebenfalls den initialen Auftrag sofort
zustellen; alle verwenden denselben Worker und dieselbe Sperre.

Eine atomare Datenbankoperation reserviert den Auftrag für fünf Minuten, erhöht
attempts und setzt eine zufällige lockToken. Abschluss und Fehlerfreigabe prüfen
dieselbe lockToken, sodass ein alter Worker keine neue Sperre überschreibt.
Nach SMTP-Erfolg werden sentAt gesetzt und Chiffrat/Sperre entfernt. Nach Fehlern
bleibt das Chiffrat erhalten; availableAt verzögert den nächsten Versuch um
30 Sekunden, dann exponentiell bis maximal eine Stunde. Fehlercode: DELIVERY_FAILED.
Abgelaufene Sperren werden nach Prozessabbruch erneut übernommen. Fehlerhafte
Aufträge blockieren durch availableAt nicht dauerhaft jüngere Aufträge.

Die vorhandene AES-GCM-Mailverschlüsselung mit AUTH_SECRET bleibt bytekompatibel.
AUTH_SECRET darf nicht gewechselt werden, solange ausstehende verschlüsselte
Ticket-/Stornierungsmails es benötigen. Die permanente Ticket-Code-Verschlüsselung
mit TICKET_CODE_ENCRYPTION_KEYS ist davon unabhängig und unverändert.

SMTP besitzt keine transaktionale Exactly-once-Zustellung: Wenn SMTP die Mail
angenommen hat, aber der Prozess vor sentAt abstürzt, kann ein Retry dieselbe Mail
erneut zustellen. Das ist die bestehende At-least-once-Grenze, keine Erzeugung
neuer Tickets oder Codes. Lange SMTP-/IMAP-Vorgänge müssen unter der Lease-Dauer
bleiben; Timeouts und Queue-Rückstand überwachen. sentAt bedeutet SMTP-Annahme,
nicht garantierte Zustellung im Posteingang.

## Deployment ohne Verlust vorhandener Stripe-Mails

Migration: `20261028160000_ticket_mail_outbox`. Sie benennt PaymentMail innerhalb
einer SQL-Transaktion um und ergänzt/backfillt Buchungs-ID, Auftrags-ID und
Initial-Request-Key. Bereits vorhandene Chiffrate, sentAt, lockedUntil und
createdAt bleiben erhalten. Es werden keine Bestätigungen kopiert, gelöscht,
neu erstellt oder nachträglich für früher direkt versendete kostenlose Buchungen
erzeugt. Ausstehende Stripe-Mails werden mit dem vorhandenen AUTH_SECRET gelesen.

1. App-Schreibzugriffe, Stripe-Verarbeitung und Cron-Worker anhalten; laufende
   SMTP-/Worker-Aufrufe auslaufen lassen. Kein Parallelbetrieb alter/neuer Worker.
   Stripe darf nicht mit 2xx quittiert werden, ohne das Event verarbeitet zu haben.
2. Backup erstellen und `npx prisma migrate deploy` manuell ausführen. Kein Reset.
3. Neue App/Worker gemeinsam starten. AUTH_SECRET und TICKET_CODE_ENCRYPTION_KEYS
   beibehalten; Cron aktivieren und Rückstau/Fehler überwachen.
4. Während des Wartungsfensters nicht zugestellte Stripe-Webhooks erneut zustellen
   lassen bzw. über den bestehenden Zahlungsabgleich nachholen. Bezahlte Buchungen
   und migrierte Initial-Aufträge bleiben idempotent.

Den angewendeten Migrationsstand je Datenbank prüfen. Ein automatischer SMTP-Retry für bereits früher fehlgeschlagene
Direktmails ist nicht rekonstruierbar; dafür kann jetzt explizit beauftragt werden.
