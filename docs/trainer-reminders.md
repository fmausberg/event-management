# Zeitgesteuerte Trainer-Reminder

Automatische Trainer-Reminder sind standardmäßig deaktiviert. Nur der serverseitige
Schalter `AUTO_TRAINER_REMINDERS_ENABLED=true` aktiviert im Reconcile-Endpunkt
`enqueueDueTrainerReminders` und `deliverPendingTrainerReminders`. Fehlende, leere
oder andere Werte lassen beide Schritte ausgeschaltet. Docker reicht den Schalter
aus `.env.docker` weiter; nach Änderungen den App-Container neu erstellen.

Bei deaktivierter Automatik verwirft jeder autorisierte Reconcile-Lauf alle noch
unversandten automatischen Trainer-Aufträge, auch bisher stornierte oder gesperrte.
Sie bleiben mit `AUTOMATIC_TRAINER_REMINDERS_DISABLED` dauerhaft storniert und werden
auch nach Reaktivierung oder erneuter Trainerzuordnung nicht wiederbelebt.
Manuelle Aufträge werden dabei nicht verworfen. Vor einer späteren Reaktivierung
mindestens einen deaktivierten Reconcile-Lauf erfolgreich abschließen. Beim
Deployment laufende Worker mit alter Konfiguration beenden; bereits an SMTP
übergebene Mails können nicht zurückgerufen werden.

Der externe Scheduler bleibt aktiv. Zahlungs- und Erstattungsabgleich, Ticket- und
Stornierungsmails, Company-Benachrichtigungen sowie Bewertungs-Einladungen laufen
unverändert weiter.

Bei explizit aktivierter Automatik sucht `POST /api/payments/reconcile` bei jedem Lauf
veröffentlichte Events mit `beginsAt > now` und `beginsAt <= now + 1 Stunde`.
Der externe Scheduler muss den Endpunkt mindestens einmal pro Minute mit
`Authorization: Bearer <PAYMENTS_CRON_SECRET>` aufrufen. Es werden keine
eventbezogenen Timer oder externen Einzeljobs angelegt.

Events ohne Beginn, ohne zugeordnete Trainer, mit anderem Status oder mit bereits
gesetztem `trainerReminderSentAt` sind nicht fällig. Pro Lauf werden höchstens 50
Events eingereiht und 50 fällige Zustellaufträge verarbeitet. Fehler eines Events
oder Auftrags werden isoliert gezählt; der nächste Cron-Lauf holt weiterhin fällige
Aufträge nach.

## Empfänger und Inhalt

Empfänger sind ausschließlich die aktuell über `EventTrainer` zugeordneten
`Trainer.email`-Adressen. Freitextnamen und andere Fallback-Adressen werden nicht
verwendet. Mehrere Trainer erhalten getrennte Zustellaufträge. Unmittelbar vor dem
SMTP-Aufruf werden Status, Beginn und Trainerzuordnung erneut geprüft und Maildaten
aus dem aktuellen Event geladen. Der Reminder enthält Eventname, Berliner Beginn,
Ort, die Summe bestätigter Plätze und einen Link auf
`/company/[companyKey]/events/[eventId]/tickets`.

Die verlinkte Übersicht erzwingt weiterhin ihre bestehende Autorisierung. Namen,
E-Mail-Adressen der Teilnehmenden und Ticketcodes stehen nicht in der Mail. Trainer
benötigen für den Zugriff weiterhin einen verifizierten, mit dem Trainerprofil
verbundenen Account.

## Idempotenz, Sperren und Retry

`TrainerReminder.requestKey = trainer-reminder:auto:<eventId>` ist der stabile,
eindeutige Schlüssel des automatischen Reminders. Jeder Empfänger besitzt zusätzlich
einen eindeutigen `MailOutbox`-Auftrag mit Event- und Trainer-ID. Datenbank-Constraints
und `createMany(..., skipDuplicates)` verhindern doppelte Aufträge bei parallelen
Cron-Läufen. Entfernte Zuordnungen werden vor dem Versand verworfen; eine später
wiederhergestellte Zuordnung verwendet denselben automatischen Auftrag erneut.
Bewusste manuelle Wiederholungen erhalten dagegen pro Klick eine neue UUID-basierte
Reminder-Charge. Eine Wiederholung desselben HTTP-Requests bleibt über diese UUID
idempotent, ein neuer Klick erzeugt absichtlich einen neuen Versand.

Die allgemeine `MailOutbox` verwendet wie die Ticket-Outbox eine fünfminütige
Lease mit zufälligem Fencing-Token. Fehler werden nach 30 Sekunden exponentiell bis
maximal eine Stunde erneut versucht. `trainerReminderSentAt` wird erst gesetzt,
wenn SMTP alle aktuell zugeordneten Trainer-Mails angenommen hat. Es bedeutet
SMTP-Annahme, nicht garantierte Zustellung im Posteingang.

SMTP und Datenbank besitzen keine gemeinsame Transaktion: Stürzt der Prozess nach
SMTP-Annahme und vor dem Speichern von `sentAt` ab, kann ein Retry dieselbe Mail
erneut senden. Diese bekannte At-least-once-Grenze entspricht der Ticket-Outbox.
Der IMAP-Gesendet-Ordner ist weiterhin nur ein Archiv und keine Queue.

## Manuelle Bedienung im Event-Drawer

Bei bestehenden Events zeigt der Bearbeitungsdrawer den Versandstatus. Der Button
**Trainer Info schicken** fordert einen neuen manuellen Reminder sofort an und
verarbeitet die Outbox direkt, unabhängig vom Automatik-Schalter. Bei deaktivierter
Automatik erfolgen keine Trainer-Retries über den Cron; nach SMTP-Fehlern kann der
manuelle Versand erneut angefordert werden. Nur bei aktivierter Automatik übernimmt
der Cron weitere Versuche. Der Button bleibt nach früheren Sendungen verfügbar. Jede erfolgreich
abgeschlossene Wiederholung aktualisiert `trainerReminderSentAt`.

Die deaktivierte Status-Checkbox zeigt zusammen mit dem rechts stehenden Zeitstempel
ausschließlich den gespeicherten Versandstatus und kann nicht verändert werden.
Der Versandbutton prüft serverseitig erneut den Company-Zugriff, die Event-Zuordnung
und die Versandfähigkeit.

## Migration und Betrieb

Migration `20261030140000_trainer_reminder_outbox` ergänzt den nullable
Event-Zeitstempel sowie `TrainerReminder`, `MailOutbox` und deren Constraints. Sie
verändert oder löscht keine bestehenden Events. Die Migration wird wie üblich beim
Deployment angewendet; es darf kein Datenbank-Reset erfolgen. Nach dem Deployment
den minütlichen Reconcile-Aufruf und dessen HTTP-Status/`failures` überwachen.

