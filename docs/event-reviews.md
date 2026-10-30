# Eventbewertungen

## Manueller Versand in der Ticketübersicht

Aktive `COMPANY_USER` und `COMPANY_ADMIN` sehen rechts in der Ticketübersicht den
Status „Noch nicht abgegeben“, „Vorläufig“ oder „Abgegeben“ sowie den letzten
Versandzeitpunkt. Reine Trainer-/Staff-Zugriffe erhalten diese Daten nicht.
Der Button „Bewertungsaufforderung senden“ erstellt eine noch fehlende Einladung
oder verschickt sie erneut, auch wenn eine frühere Mail bereits versendet wurde.
Er prüft serverseitig Mitgliedschaft, Company/Event-Zuordnung, Ticket-Check-in,
Eventende und Empfängeradresse. Abgeschlossene Bewertungen bleiben gesperrt.

Jeder neue Versandklick erhält eine UUID; Wiederholungen derselben Anfrage legen
keinen zweiten Versandauftrag an. Die vorhandene Outbox-Zeile wird nach Prüfung
ihrer Worker-Sperre wiederverwendet und unmittelbar zugestellt. Bei Fehlern greift
der vorhandene Cron-Retry. Vorläufiges Feedback bleibt erhalten. Zusätzliche
Linktokens werden ausschließlich gehasht in `EventReviewResendToken` gespeichert;
alte und neue Links führen zur selben Bewertung und werden gemeinsam durch die
finale Abgabe gesperrt. Manueller Neuversand verlängert die gemeinsame Gültigkeit
auf 30 Tage ab Neuversand. Dafür ist zusätzlich die Migration
`20261030160000_review_resend_tokens` erforderlich.

## Teilnahme und Zuordnung

`Ticket.checkedInAt != null` entspricht einer eingelösten Teilnahme; ein eigener
`REDEEMED`-Enumwert existiert nicht. Erst wenn `Event.endsAt` erreicht ist und das
Event `PUBLISHED` oder `COMPLETED` ist, erstellt der Reconciliation-Job Einladungen.
Ohne Endzeit gibt es keine Einladung. Maßgeblich ist die tatsächliche Teilnahme,
nicht allein der Buchungsstatus (etwa bei einer späteren Erstattung).

Tickets haben keine individuellen Teilnehmeradressen. Daher gibt es genau eine
Bewertung je Event und normalisierter Buchungs-E-Mail, auch über mehrere Buchungen
oder Gruppentickets hinweg. Wie in der Buchungsverwaltung dient bei fehlender
Buchungs-E-Mail die zugeordnete User-E-Mail als Fallback. Ein eingelöstes Ticket
und dessen Buchung dienen als Teilnahmebeleg. Verschiedene Personen mit einem
gemeinsamen Postfach teilen damit eine Einladung; verschiedene Adressen derselben
Person können ohne zusätzliche Identitätsdaten nicht sicher zusammengeführt werden.

`EventReview` vereint Einladung und Feedback. Unique Constraints auf
`(eventId, recipientEmail)`, `tokenHash`, `MailOutbox.reviewId` und `requestKey`
verhindern doppelte Einladungen. Die Einladung entsteht mit dem Outbox-Auftrag in
einer serialisierbaren Transaktion. Ein Konflikt wird beim nächsten Job aufgeholt.
Ungültige Bestandsadressen werden übersprungen; die Kandidatenabfrage blättert
weiter, damit spätere Empfänger nicht blockiert werden.

## Link und Abgabe

Der zufällige 256-Bit-Token wird nur als SHA-256-Hash im Bewertungsmodell gespeichert.
Der Link lautet `/reviews#token=…&rating=1` (bis 5). Der Fragmentteil verhindert,
dass Token in HTTP-Zugriffslogs oder Referer erscheinen. Keine Request-Bodies der
Server Actions in Proxy/APM protokollieren; keine Drittanbieter-Analytics auf dieser
Seite einbinden. Die Seite setzt `noindex` und `no-referrer`.

**GET und der Datenabruf selbst bleiben lesend.** Nach dem Laden speichert die
Seite den Gesamtwert aus dem Mail-Link automatisch per Server Action POST.
Jeder Sternklick speichert sofort ausschließlich die betroffene Kategorie;
„Nicht bewerten“ setzt die optionale Kategorie auf `null`. Kommentare bleiben
bis zum Absenden lokal. „Bewertung absenden“ übernimmt nur die Kommentare,
setzt `submittedAt` und den Status `COMPLETED`; vorhandene Sterne bleiben erhalten.
Fehlgeschlagene Sternspeicherungen müssen vor dem Abschluss wiederholt werden.
Diese bewusste Produktentscheidung erlaubt vorläufige Bewertungen durch Scanner,
die JavaScript ausführen. Ein reiner GET-Scanner speichert weiterhin nichts.
Schließen, Reload oder erneute Mailklicks verbrauchen den Token nicht. Der Link ist
30 Tage ab Einladungserstellung gültig, auch bei Versandwiederholungen. Bereits
abgeschlossene Links zeigen danach weiterhin eine freundliche Empfangsbestätigung.

Jede Mutation validiert den Tokenhash, Ablauf, Eventende und Teilnahme neu.
Next.js Server Actions prüfen Origin/Host gegen CSRF. Bedingte Updates mit
`status=PROVISIONAL` sperren konkurrierende Änderungen nach dem Abschluss.
Sterne sind serverseitig und über SQL-CHECKs auf Ganzzahlen 1–5 beschränkt,
Kommentare auf 2000 Zeichen. Ohne zugeordneten Trainer oder Legacy-Trainername
wird Trainerfeedback weder angeboten noch gespeichert.

## Versand und Betrieb

Die Migration `20261030150000_event_reviews` muss vor Deployment des neuen Codes
über den üblichen kontrollierten Migrationsprozess angewendet werden. Für den
manuellen Neuversand ist auch `20261030160000_review_resend_tokens` anzuwenden.

Es gibt keine neue Queue und keinen neuen Cron-Endpunkt. Der bestehende geschützte
`POST /api/payments/reconcile` erstellt bis zu 50 Einladungen und verarbeitet bis
zu 50 Bewertungsmails pro Aufruf. Den bestehenden Scheduler regelmäßig (z.B. jede
Minute) mit `Authorization: Bearer PAYMENTS_CRON_SECRET` aufrufen. Ohne diesen Job
werden keine Einladungen erzeugt oder wiederholt.

Benötigt werden die vorhandenen SMTP-Variablen, `AUTH_SECRET` zur Verschlüsselung
des wartenden Mailinhalts, `AUTH_URL` (HTTPS in Produktion) und
`PAYMENTS_CRON_SECRET`. Es sind keine neuen Secrets nötig. `MAIL_TEST_RECIPIENT`
gilt auch für Bewertungsmails. `AUTH_SECRET` nicht wechseln, solange verschlüsselte
Nachrichten warten, ohne deren Wiederherstellung zu planen.

`MailOutbox.kind=EVENT_REVIEW` nutzt denselben verschlüsselten Payload-Worker wie
Ticketmails, mit 5-Minuten-Lease, Fencing-Token und exponentiellem Retry bis eine
Stunde. Vor Versand werden Ende, Status und Teilnahme erneut geprüft. Nicht mehr
zulässige Events bleiben bis Ablauf im Retry; abgelaufene/abgeschlossene Einladungen
werden verworfen und ihr Payload gelöscht. Erfolgreicher Versand setzt `sentAt`
atomar auf Outbox und Einladung und löscht den verschlüsselten Payload. SMTP kann
bei einem Absturz nach Annahme, aber vor DB-Bestätigung eine Mail doppelt zustellen;
beide enthalten denselben Link und ermöglichen keine zweite Bewertung.

## Interne Auswertung

Die Company-Tabellen für Trainer und Venues zeigen zusätzlich eine gemeinsame
Bewertungskennzahl. `getCompanyTrainers` und `getCompanyVenues` prüfen zuerst den
bestehenden Company-Zugriff und lesen anschließend über `getCompanyEntityRatings`
gebündelte Summen und Antwortzahlen je Event. Ausschließlich `COMPLETED` mit
gesetztem `submittedAt` und einer nicht leeren jeweiligen Kategorie zählen mit.
Die Gesamtdurchschnitte werden aus Summen und Anzahlen gebildet, damit Events mit
unterschiedlich vielen Antworten korrekt gewichtet werden. Es gibt höchstens
zwei zusätzliche Abfragen je Übersicht, keine Abfrage pro Tabellenzeile.

Trainer werden ausschließlich über `EventTrainer`, Venues über `Event.venueId`
zugeordnet, jeweils auf die autorisierte Company begrenzt. Eine gemeinsame
Trainerbewertung eines Events zählt für jeden explizit zugeordneten Trainer.
Events ohne Trainerzuordnung (auch mit bloßem Legacy-Trainername) liefern keine
Trainerkennzahl. Namen, E-Mail-Adressen und Serienvorgaben werden nicht zur
Zuordnung verwendet. Historische Zuordnungssnapshots existieren nicht; maßgeblich
sind die gespeicherten Event-Zuordnungen, keine Rekonstruktion aus Stammdaten.

Ab der ersten abgeschlossenen Antwort erscheint der Durchschnitt mit einer
deutschen Dezimalstelle, Stern und Antwortzahl. Es gibt keine Mindestschwelle;
bei null Antworten erscheint „Noch keine Bewertungen“.
Beide Tabellen nutzen dieselbe `RatingSummary`-Komponente. Kommentare und
personenbezogene Bewertungsdetails werden nicht geladen oder angezeigt.

Links in der Company- und Admin-Eventverwaltung führen zur Auswertung unter
`/company/[companyKey]/events/[eventId]/reviews`. Vor jedem Datenzugriff prüfen
die vorhandenen `requireBookingEvent`/`requireCompanyAccess`-Funktionen die aktive
Company-Mitgliedschaft bzw. globale Adminrolle und die Eventzugehörigkeit.
Company-Mitglieder erhalten dadurch keine globalen Adminrechte.

Gezählt werden erstellte und versendete Einladungen, vorläufig gespeicherte
Bewertungen (Gesamtwert vorhanden) und abgeschlossene Bewertungen. Durchschnitte
und Antwortzahlen je Kategorie stammen ausschließlich aus abgeschlossenen
Bewertungen; `null` zählt nicht mit. Es werden weder Adressen noch Kommentare oder
andere individuelle Bewertungsdaten öffentlich angezeigt.
