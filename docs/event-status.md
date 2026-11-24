# Eventstatus



Neue Events und Entwürfe bieten **Entwurf speichern** und **Veröffentlichen**.

Veröffentlichte Events bieten **Speichern** und **Absagen**. Die Absage ändert

nur den Status; nicht gespeicherte Formularänderungen werden verworfen.

Bestehende Buchungen bleiben erhalten. Es werden keine automatischen

Rückerstattungen oder Absage-E-Mails ausgelöst.



Abgesagte und abgeschlossene Events können bearbeitet werden, ihr Status bleibt

erhalten. Der Server prüft Statusübergänge unabhängig vom UI.



Die Tabelle zeigt Entwürfe gelb, veröffentlichte Events grün, abgesagte Events

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
