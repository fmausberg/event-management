# Eventstatus



Neue Events und Entwürfe bieten **Entwurf speichern** und **Veröffentlichen**.

Veröffentlichte Events bieten **Speichern** und **Absagen**. Die Absage ändert

nur den Status; nicht gespeicherte Formularänderungen werden verworfen.

Bestehende Buchungen bleiben erhalten. Es werden keine automatischen

Rückerstattungen oder Absage-E-Mails ausgelöst.



Abgesagte und abgeschlossene Events können bearbeitet werden, ihr Status bleibt

erhalten. Der Server prüft Statusübergänge unabhängig vom UI.



Die Tabelle zeigt Entwürfe hellgrau, ausstehende Trainer-/Ortsfreigaben gelb,
veröffentlichte Events grün, abgesagte Events

rot und abgeschlossene Events grau. Es gibt derzeit keinen automatischen

Statuswechsel nach dem Eventende.



## Trainer confirmation before publication



Publishing an event with assigned trainers first sets its status to

`PENDING_TRAINER_CONFIRMATION` (Trainer confirmation pending). Each current

`EventTrainer` has an independent `responseStatus`: `PENDING`, `ACCEPTED` or

`ISSUE`, plus `respondedAt`. Events without trainers can still publish directly.

Only when all current assignments are accepted does the event become `PUBLISHED`.

Public lists and event pages additionally exclude unaccepted assignments.



The same rule applies to individual and batch creation, Company event edits,

the global editor and trainer replacements through series updates. Existing

assignments keep their responses; a newly added or replaced assignment starts

pending. Pending events can be edited or cancelled in the existing Company UI.

Removing all assignments allows publication. An issue never automatically cancels

an event or selects a replacement trainer.



Trainers respond from `/account/eventmanagement`. Only the verified account

linked to the assigned trainer can respond. Accepting is allowed while the event is pending confirmation and the assignment

is PENDING or ISSUE; problems can also be reported later. An issue requires 1 to 20000 trimmed characters.

Its text becomes a COMPANY-visible Event note, attributed to the trainer's user

with the normal creation timestamp. Removing the assignment preserves the note.

Concurrent responses and edits use serializable transactions; a conflict asks

the user to reload and retry without storing a partial response.



Requests to trainers and issue notifications use encrypted `MailOutbox` jobs,

stable request keys, the existing lease/retry worker and the protected payment

reconcile job. Immediate delivery is attempted after commit. Trainer requests

are checked again for a current pending assignment before each delivery.

Issue recipients must be active Company members with `notifyTrainerIssues`

enabled and a linked verified account; eligibility is rechecked before delivery.



Deployment: apply the Prisma-generated schema migration
`20261124124503_trainer_event_confirmation` and the separate data migration
`20261124124914_backfill_existing_trainer_confirmations` through the existing
`npx prisma migrate deploy` workflow. Keep the already recorded empty migration
`20261124124855_trainer_event_confirmation` unchanged as part of the history.

The backfill marks existing assignments on published, completed and cancelled
events as ACCEPTED. Draft assignments retain the PENDING default. Prisma cannot
infer this data update from the schema. Regenerate the Prisma client with
`npm run db:generate` (also part of prebuild) and restart the development server
after schema changes. A JWTSessionError can wrap a database error from the
session callback if the client expects columns that have not been migrated.

## Problems after acceptance

Every trainer assignment shown in `/account/eventmanagement` has a permanent
"Problem melden" action, including accepted assignments and past, cancelled or
completed events. Acceptance is available for PENDING and ISSUE assignments while the event awaits
confirmation. After reporting a problem, the trainer can use the green checkmark
to accept again once it is resolved. Existing problem notes remain in the history;
the event publishes again when all current assignments are ACCEPTED.
A problem requires text, sets the assignment to ISSUE and creates a Company-visible
Event note and the configured Company email notifications. Published events return
to pending trainer confirmation; cancelled/completed events retain their status.
Trainers can report further problems. A per-submission request ID prevents repeated
requests from creating duplicate notes or notifications, without blocking new reports.

## Sammelanfragen und bereits erfolgte Trainerzustimmung

Bei der Mehrfacherstellung mit Veröffentlichung erhält jeder zugeordnete Trainer
nur eine Bestätigungsanfrage mit allen Terminen (Titel, Datum, Beginn, Ende, Ort
und Company) und einem Link zur Veranstaltungsverwaltung. Dort bleibt jeder
Termin einzeln beantwortbar. Entwurfserstellungen versenden keine Anfrage.

Die Sammelanfrage nutzt dieselbe verschlüsselte Outbox, Retry- und Lease-Logik wie
Einzelanfragen. Pro Zuordnung wird ihr bestehender Request-Key reserviert:
ein aktiver Sammelauftrag und für die weiteren Zuordnungen stornierte Marker mit
`COVERED_BY_BATCH`. Dadurch erzeugen spätere Statusabgleiche keine zusätzlichen
Einzelmails. Vor jedem Versandversuch werden entfernte, beantwortete, abgesagte
und bereits beendete Termine aus der Sammelanfrage herausgefiltert.

Bei der Einzel- und Mehrfacherstellung können berechtigte Company-User und
Company-Admins explizit „Trainerzustimmung bereits erfolgt“ auswählen. Die Option
ist standardmäßig aus und gilt für alle ausgewählten Trainer und Termine.
Die Zuordnungen werden dann direkt als ACCEPTED mit Antwortzeitpunkt gespeichert.
Eine Company-sichtbare Event-Notiz dokumentiert die Erklärung mit dem erstellenden
Mitglied als Autor. Es wird keine Bestätigungsanfrage erzeugt; beim Veröffentlichen
ist keine zusätzliche Trainerfreigabe erforderlich. Als Entwurf gespeicherte Events
bleiben Entwürfe. Später neu zugeordnete Trainer starten weiterhin als PENDING.
Die normalen Event- und Steuerprüfungen sowie die Möglichkeit, später Probleme
zu melden, gelten unverändert. Dafür ist keine Schemaänderung erforderlich.

## Manuelle Trainerfreigabe im Event-Editor

Company-User und Company-Admins können bestehende Trainerzuordnungen im Event-Editor
zwischen „Pending – Antwort ausstehend“ und „Approved – Zugesagt“ umstellen.
Approved wird intern weiterhin als ACCEPTED gespeichert. Auch ein gemeldetes
Issue kann telefonisch geklärt und manuell freigegeben werden; seine Notiz bleibt
erhalten. Die Änderungen werden zusammen mit dem Event über Speichern übernommen.

Der Server prüft aktive Company-Mitgliedschaft bzw. globale Adminrechte, die
Zuordnung zur Company und zum Event sowie den ursprünglichen Antwortstatus und
Antwortzeitpunkt. Zwischenzeitliche Trainerantworten werden nicht überschrieben.
Die vorhandene Audit-Fassade erfasst Statuswechsel und Company-Mitglied als Akteur.

Bei PENDING oder ISSUE einer aktuellen Zuordnung bleibt ein zur Veröffentlichung
vorgesehenes Event unveröffentlicht und damit nicht buchbar. Sind alle Zuordnungen
ACCEPTED, erfolgt die erneute Veröffentlichung nach den bestehenden Prüfungen.
Entwürfe bleiben Entwürfe; abgesagte, abgeschlossene und bereits beendete Events
werden durch diese Option nicht erneut freigegeben.

Manuelle Statuswechsel erzeugen und versenden keine E-Mails. Bei einem manuellen
Reset auf PENDING bleibt respondedAt als Zeitpunkt der administrativen Änderung
gesetzt. Statusabgleich und Mail-Worker erkennen daran, dass keine neue Anfrage
gewünscht ist. Bereits wartende Einzel- und Sammelanfragen schließen solche
Zuordnungen ebenfalls aus, ohne andere Termine einer Sammelmail zu unterdrücken.
Neue Zuordnungen haben weiterhin respondedAt = NULL und verwenden den normalen
Bestätigungsablauf. Es ist keine Schemaänderung erforderlich.

## Zweistufige Freigabe: Trainer, danach Ortsteam

Der vollständige Veröffentlichungsablauf ist jetzt:
DRAFT -> PENDING_TRAINER_CONFIRMATION -> PENDING_VENUE_CONFIRMATION -> PUBLISHED.
Ohne Trainer wird Stufe eins übersprungen. Ohne Ortsteam wird die Ortsfreigabe
automatisch erteilt. Ein Event wird erst nach allen Trainerzusagen und erteilter
Ortsfreigabe öffentlich und buchbar. Die normalen Pflichtfeld- und Steuerregeln
gelten zusätzlich. CANCELLED und COMPLETED werden nicht automatisch wieder geöffnet.

`EventVenueApproval` speichert genau eine kollektive Ortsfreigabe je Event mit
Ort, Status (PENDING/ACCEPTED/ISSUE), Antwortzeitpunkt, antwortendem User und
manuellem Freigabemarker. Die Zustimmung eines aktuell zugeordneten Ortsteam-
Mitglieds reicht. Authentifizierung, verifizierter Account, aktuelle VenueStaff-
Zuordnung und Versionsstand werden innerhalb derselben serialisierbaren
Transaktion geprüft. Die erste Antwort entscheidet; veraltete parallele Antworten
müssen nach Neuladen erneut bewusst abgegeben werden.

Das Ortsteam erhält die Anfrage erst nach abgeschlossener Trainerstufe. Bei einer
Mehrfacherstellung bleibt die Batch-Zuordnung auch über getrennte Trainerantworten
erhalten: Erst wenn die Trainer der noch aktiven, nicht beendeten Batch-Termine
zugesagt haben, wird eine Sammelanfrage pro Empfänger mit der Terminliste angelegt.
Abgesagte/abgeschlossene Termine blockieren die Sammelanfrage nicht. Die Outbox
verwendet feste Request-Keys, verschlüsselte Inhalte, bestehende Leases und Retries.
Vor jedem Versand werden aktuelle Teamzugehörigkeit und offene Freigaben erneut
geprüft. Entfernte Zuordnungen, manuell gesetzte PENDING-Freigaben und bereits
beantwortete Termine werden nicht angefragt.

Unter `/account/eventmanagement` kann das Ortsteam mit denselben Icons wie der
Trainer zusagen, ein Problem melden und nach Klärung erneut zusagen. Ein Problem
benötigt 1 bis 20000 getrimmte Zeichen. Es erzeugt eine COMPANY-Eventnotiz mit
Mitglied als Autor und eine idempotente Company-Benachrichtigung an aktive,
verifiziert verknüpfte Mitglieder mit aktivem `notifyVenueIssues`. Die vorhandenen
Mitgliederrechte gelten auch für diese neue, standardmäßig aktivierte Option.
Eine Teamantwort gilt für alle Mitglieder. Neue Probleme nach einer Zusage
nehmen das Event wieder aus der Veröffentlichung; die Company entscheidet über
den weiteren Ablauf. Audit-Einträge und Notizen bleiben auch bei Ortswechseln erhalten.

Ein Ortswechsel ersetzt die bisherige Ortsfreigabe durch eine neue, offene
Freigabe, einschließlich Ortswechseln über Serienvorgaben. Ohne Team am neuen Ort
ist diese wieder automatisch erteilt. Ein späteres Trainer-Issue setzt dagegen
nur die Trainerstufe zurück und erhält eine bereits erteilte Ortsfreigabe.
Beim Entfernen des letzten Ortsteam-Mitglieds werden wartende Freigaben automatisch
erteilt. Der Reconcile-Job deckt auch User-Löschungen mit VenueStaff-Kaskaden ab.
Später neu hinzugefügte Teammitglieder widerrufen bereits erteilte Freigaben nicht.

Bei der Eventerstellung kann „Ortsfreigabe bereits eingeholt“ für alle ausgewählten
Termine aktiviert werden. Es entstehen direkt ACCEPTED-Freigaben und eine
Company-sichtbare Bestätigungsnotiz mit dem erstellenden Mitglied als Autor;
Bestätigungsmails an das Ortsteam entfallen. Die Trainerstufe bleibt unabhängig.
Company-User und Company-Admins können die Ortsfreigabe im Event-Editor manuell
auf Approved oder Pending setzen, auditiert und ohne Anfrage-/Benachrichtigungsmails.

### Schema und Deployment

Wie gewünscht wird die Migration aus dem geänderten Prisma-Schema erzeugt,
nicht als handgeschriebene Migrationsdatei bereitgestellt:

```sh
npx prisma migrate dev --name venue_event_confirmation
npm run db:generate
```

Nur gegen die lokale Entwicklungsdatenbank ausführen. Die von Prisma erzeugte
Migration verwendet das Timestamp-Namensschema. Auf Servern die eingecheckte
Migration mit `npx prisma migrate deploy` anwenden, den Client generieren und die
Anwendung neu starten. Diese Schemaänderung muss vor dem neuen Anwendungscode
angewendet werden, da die Audit-Fassade das neue Modell und Mitgliedsfeld benutzt.
Es ist kein Datenbank-Reset und kein Daten-Backfill erforderlich.

Die Migration ändert keine vorhandenen Eventstatuswerte. Bereits veröffentlichte,
abgesagte und abgeschlossene Bestands-Events ohne neuen Freigabedatensatz gelten
hinsichtlich ihres bisherigen Orts als freigegeben. Sie bleiben sichtbar und
können vom aktuellen Ortsteam weiterhin mit Problemen versehen werden.
Der explizite Datensatz wird bei Bedarf erzeugt. Beim Ortswechsel wird zuvor
der bisherige Ort verankert, sodass auch Bestands-Events eine neue Ortsfreigabe
benötigen. Bestehende, noch nicht veröffentlichte Events durchlaufen die neue
Ortsstufe nach ihren Trainerzusagen. Gespeicherte Notizen bleiben unverändert.

### Welche Ortsteam-Mitglieder zählen?

Im Freigabeverfahren zählen ausschließlich VenueStaff-Zuordnungen mit verknüpftem
User-Account (`userId` gesetzt) und verifizierter Account-E-Mail (`emailVerified`
gesetzt). Reine E-Mail-Zuordnungen ohne Account und unverifizierte Accounts zählen
nicht. Zwei eingetragene Studio-Adressen ohne verifizierten, verknüpften Account
bedeuten daher null relevante Teammitglieder: Die Ortsfreigabe erfolgt automatisch.

Die gemeinsame Bedingung in `lib/venues/approval-members.ts` gilt für Einzel- und
Mehrfacherstellung, Statusabgleich, manuelle Freigaben, Company-Anzeige,
Empfängerauswahl und erneute Prüfung vor dem Mailversand. An unregistrierte oder
unverifizierte Ortsteam-Adressen werden keine Freigabeanfragen versendet. Die
bestehenden Zuordnungseinladungen sind davon unabhängig. Wartende Freigaben werden
auch nach Account-Löschung oder Entzug der Verifizierung automatisch erteilt,
wenn kein relevantes Mitglied mehr verbleibt; dies übernimmt der Reconcile-Job.
Die Trainerstufe bleibt erforderlich. Eine spätere Registrierung/Verifizierung
widerruft eine bereits automatisch erteilte Ortsfreigabe nicht.

## Statusanzeige

Eventstatus verwenden zentral `lib/events/status-presentation.ts`: Entwurf
(hellgrau), Trainerfreigabe und Ortsfreigabe (gelb), Veröffentlicht (grün),
Abgesagt (rot), Abgeschlossen (grau). Die kurzen Freigabelabels gelten für
Company-Listen, Eventdetails/Editor und die Account-Veranstaltungsverwaltung.
Die Company-Veranstaltungsübersicht hat keine eigene Reihenspalte mehr;
die Veranstaltungsreihe ist weiterhin über die Eventdetailseite erreichbar.

## Gemeinsame Aktionen je Event in der Account-Verwaltung

Die Aktionsspalte in `/account/eventmanagement` zeigt pro Event höchstens einen
Bestätigungshaken und ein Problem-Dreieck. Rollenbezeichnungen, Zusagetexte und
Bestätigungsaufforderungen stehen nicht mehr in dieser Spalte. Nach vollständiger
eigener Zusage entfällt der Haken; das Problem-Dreieck bleibt verfügbar.

`lib/events/approval-response.ts` ermittelt die aktuellen eigenen Rollen aus der
Datenbank. Ein Klick bestätigt alle noch offenen eigenen Trainerzuordnungen und,
falls der Nutzer auch zum verifiziert verknüpften Ortsteam gehört, dessen offene
kollektive Ortsfreigabe. Diese Doppelrolle darf beide eigenen Erklärungen gemeinsam
abgeben, auch wenn weitere Trainer noch nicht geantwortet haben. Fremde Trainer
werden nie mitbestätigt und blockieren die Veröffentlichung weiterhin. Für reine
Ortsteam-Mitglieder bleibt die normale nachgelagerte Ortsstufe erhalten.

Hat ein Kollege die Ortsfreigabe schon erteilt, bleibt diese unverändert und der
zugeordnete Trainer kann seine weiterhin offene Trainerfreigabe separat über
denselben Haken abschließen. Ein veralteter Orts-Versionsstand verhindert dann
keine Trainerzusage; noch offene Ortsfreigaben werden vor Änderung dagegen
weiterhin auf parallele Teamantworten geprüft.

Eine gemeinsame Problemmeldung setzt die eigenen betroffenen Rollen auf ISSUE,
erzeugt genau eine COMPANY-Notiz und einen Versandauftrag je berechtigtem
Company-Empfänger. Bei Doppelrollen genügt eine der aktivierten Einstellungen
notifyTrainerIssues/notifyVenueIssues; die Empfänger werden dedupliziert und
vor Versand erneut geprüft. Wiederholte Requests mit derselben Meldungs-ID
erzeugen keine zweite Notiz oder Mail. Beide Rollenänderungen, die Notiz und die
Outbox werden in einer serialisierbaren Transaktion gespeichert und einzeln im
bestehenden Audit erfasst. Der abschließende Statusabgleich erfolgt erst nach
allen eigenen Antworten, damit keine vorübergehende Ortsanfrage an die gerade
selbst bestätigende Person entsteht. Keine zusätzliche Schemaänderung.

### Sichtbarkeit des Ortsteams vor der Trainerfreigabe

In `/account/eventmanagement` sehen reine Ortsteam-Mitglieder ein Event erst,
wenn alle aktuellen Trainerzuordnungen ACCEPTED sind. Solange die Trainerstufe
offen ist, erscheint es ausschließlich bei den zugeordneten Trainern; eine
gleichzeitige Ortsteam-Rolle verhindert diese Traineransicht nicht. Das gilt
auch nach einem späteren Trainer-Issue oder manuellem Reset: Die vorhandene
Ortsfreigabe bleibt gespeichert, verschafft reinen Ortsteam-Mitgliedern aber
keine vorzeitige Sichtbarkeit. Veraltete Antwortformulare werden zusätzlich
serverseitig auf die abgeschlossene Trainerstufe geprüft. Eine Doppelrolle kann
weiterhin beide eigenen Erklärungen gemeinsam abgeben.
