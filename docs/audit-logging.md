# Audit-Logging

## Umfang und Architektur

Der zentrale Zugang in `lib/db/prisma.ts` verwendet Prisma 7.10 mit PostgreSQL-
Treiberadapter und einer Audit-Fassade. Es gibt kein `$use`, keine privaten
Prisma-APIs und keinen Auth.js-Aufruf aus der Datenbankschicht.

Die explizite Modell-Allowlist umfasst `EventSeries`, `Event`, `Venue`,
`Trainer`, `Company` und `CompanyMembership`. Andere Modelle erhalten keine
eigenen Audit-Einträge. Die Registry liegt in `lib/audit/policy.ts`.
Ein Event protokolliert zusätzlich seine sortierten Trainer-IDs aus
`EventTrainer`; die Zuordnungstabelle erhält keine eigene Historie.

Direktes Create/Update/Delete, die Many- und Returning-Varianten sowie Upsert
werden unterstützt. Pro tatsächlich geändertem Datensatz entsteht ein Eintrag;
identische Werte, reine technische Zeitstempel und übersprungene Duplikate
erzeugen keinen UPDATE-Eintrag. Neue Schemafelder werden nicht automatisch
aufgenommen.

## Feldpolitik und Zielobjekt

Die verbindlichen Feldlisten und Beschriftungen stehen in der Policy:

| Modell | Gespeicherte Werte |
| --- | --- |
| EventSeries | Nummer, Name, Kurz-/Langbeschreibung, Company-/Ersteller-/Ort-/Trainer-ID, Stornofrist, Dauer, Plätze, Preis, Währung |
| Event | Nummer, Name, Kurz-/Langbeschreibung, Company-/Reihen-/Ersteller-/Ort-ID, Beginn/Ende, Status, Plätze, Preis, Währung, Stornofrist, Trainer-IDs |
| Venue | Nummer, Name, Company-ID, Stadt, Land |
| Trainer | Nummer, Vor-/Nachname, Company-/User-ID |
| Company | Nummer, Name, Slug, Zahlungs-/Auszahlungsfreigabe |
| CompanyMembership | Nummer, Company-/User-ID, Rolle, Status |

Nur Änderungsmarker, keine gespeicherten Werte: Bildadressen/-referenzen,
veraltete Trainernamen, Trainer-E-Mail, Mitgliedschafts-Einladungsadresse,
Adresszeilen, Postleitzahl und Stripe-Konto-ID. Diese expliziten Felder werden
transient für den Vergleich gelesen; in Audit-JSON gelangen nur ihre Feldnamen
in `redactedFields`. Bei Create/Delete gibt es nur freigegebene Snapshots.
Passwörter, Tokens, Zahlungs-Payloads und unkontrollierte Fehlertexte bleiben
ausgeschlossen.

Kurzbeschreibungswerte werden seit Policy-Version 2 gespeichert,
Langbeschreibungen seit Version 3; seit Version 4 gelten die weiteren Modelle
und Zielidentitäten. Alte Marker und UNKNOWN-Akteure bleiben unverändert.
Beschreibungen werden als Werte des fachlichen Datensatzes übernommen und in
der UI ausschließlich als escapeter JSON-Text ausgegeben, niemals als HTML.

`AuditLog.recordNumber` und `recordName` speichern ab Version 4 die Identität
des Zielobjekts, damit Umbenennungen und Löschungen die Zuordnung nicht zerstören.
Bei Trainern ist der freigegebene Name Vorname plus Nachname. Bei Mitgliedschaften
wird der vorhandene User-Name übernommen; für Einladungen ohne verknüpften
Nutzer bleibt die Bezeichnung „Mitgliedschaft“ plus Nummer. Es wird keine
Einladungs-E-Mail zur Zielidentifikation gespeichert. Company verwendet ihre
eigene ID als `companyId`. Es gibt keine kaskadierenden Audit-Fremdschlüssel.

Für ältere Reihen-Einträge ohne Identitätssnapshot wird, soweit vorhanden,
die aktuelle Reihe nachgeladen. Dies ist keine historische Rekonstruktion.
Für bereits gelöschte alte Objekte kann nur die gespeicherte ID verfügbar sein.
Personennamen und IDs sind personenbezogene Daten. Ihre Aufnahme zur gewünschten
Zielidentifikation ersetzt keine spätere fachliche Aufbewahrungsentscheidung.

## Transaktionen, verschachtelte Writes und Kaskaden

Außerhalb bestehender Transaktionen öffnet die Fassade eine kurze interaktive
Transaktion. In bestehenden Callback-Transaktionen verwenden Vorherzustand,
Mutation, Nachherzustand und Audit-Insert denselben ursprünglichen `tx`.
Optionen wie Isolation/Timeout bleiben erhalten. Gleichzeitige Writes innerhalb
eines Callbacks werden serialisiert; auch globale Clientaufrufe im Callback
werden an diesen Transaktionskontext gebunden. Ein Schreib-/Auditfehler markiert
die Transaktion auch dann als fehlgeschlagen, wenn der Fachcallback ihn abfängt.
Es gibt keine neuen automatischen Retries oder externen Seiteneffekte im Executor.

Verschachtelte Änderungen werden über öffentliche Prisma-Relationsmetadaten
erkannt, auch unter nicht auditierten Eltern. Die Snapshots der freigegebenen
Modelle erfassen tatsächliche Effekte von nested Create/Update/Delete, Upsert,
ConnectOrCreate sowie Connect/Disconnect/Set und Datenbankkaskaden.
Trainerlöschungen können beispielsweise EventSeries.suggestedTrainerId auf NULL
setzen; User-Löschungen können Trainer.userId auf NULL setzen. EventTrainer-
Änderungen erscheinen als Event-Updates des Feldes trainerIds. Bestehende
RESTRICT-Regeln bleiben bestehen und können Löschungen verhindern.

Nicht unterstützt und kontrolliert abgewiesen: Primärschlüsseländerungen an
freigegebenen Modellen und User, Company-Wechsel bestehender auditierter
Datensätze (auch indirekt, dann mit Rollback), unbekannte nested Operationen,
`$transaction([...])`, verschachtelte Transaktionsaufrufe und öffentliches
`$extends`. Modell-Writes bleiben bis zum Await verzögert, damit eine abgewiesene
Array-Transaktion nicht bereits vorab Änderungen ausführt.

Raw-SQL ist nur für die exakt geprüften Templates in `lib/audit/raw.ts`
freigegeben: Healthcheck, vorhandene Voucher-Zeilensperren/Advisory-Locks und
Review-Kandidatenabfrage. Andere Templates, schreibendes Raw-SQL und Unsafe-
Methoden werden abgewiesen. Ein SELECT-Präfix genügt nicht als Sicherheitsprüfung,
weil Funktionen Daten verändern könnten. Direkte manuelle SQL-Änderungen
außerhalb des Anwendungszugangs werden nicht auditiert.

**Leistungsgrenze:** Jeder auditpflichtige Write sperrt alle sechs freigegebenen
Tabellen in derselben Reihenfolge mit SHARE ROW EXCLUSIVE und liest vor und nach
der Mutation alle Datensätze mit einer expliziten Feldprojektion. Nur tatsächliche
Feldänderungen werden gespeichert. Das unterstützt beliebige Bulk-WHEREs,
verschachtelte Writes und Kaskaden konsistent, verursacht aber zwölf
Tabellenscans (plus Projektion der Event-Trainerzuordnungen und Mitgliedsnamen)
und serialisiert Schreibzugriffe über die Modelle/Companies hinweg. Die Sperren
bleiben bis zum Commit der bestehenden Transaktion bestehen; normale Leser
bleiben möglich. Lange Callbacks und bestehende Sperren können Wartezeiten oder
Deadlocks erzeugen. Diese führen zu Fehler/Rollback, nicht zu einer Erfolgshistorie.
Vor hoher Last sind gezielte Snapshots und eine geprüfte Zeilensperrstrategie
erforderlich. Ein neues Modell benötigt Policy, Relations-/Kaskadenprüfung und
gegebenenfalls Anpassungen für andere Primärschlüssel oder besondere Feldtypen.

## Akteur und Herkunft

Die Server Actions für Events, Orte, Trainer, Mitgliedschaften, Companies und
Stripe-Onboarding verwenden `withSessionAudit`; die Reihen-Actions verwenden
ihren bestehenden `withAuditContext`-Wrapper. Nur serverseitiges `auth()`
liefert USER und actorUserId. Formulardaten oder betroffene Datensätze sind keine
Akteurquelle. Die fachlichen Berechtigungsprüfungen bleiben zusätzlich erhalten.
Die Admin-Event-Löschaktion prüft ausdrücklich requireAdmin.

Automatisches Zuordnen verifizierter Mitgliedschaften und Trainerprofile läuft
als SYSTEM / auth.claim-verified-assignments. Der Reconcile-Endpunkt setzt SYSTEM
erst nach erfolgreicher Cron-Secret-Prüfung. Stripe-Statusabgleich übernimmt den
angemeldeten Session-Akteur bzw. ANONYMOUS, wenn er aus einem öffentlichen Ablauf
angestoßen wird. Technische Reminder-Zeitstempel selbst sind nicht freigegeben.

AsyncLocalStorage transportiert Kontext und Korrelations-ID. Die Stores werden
über globalThis pro Prozess geteilt; nur der Basisclient/Pool wird global gecacht.
Die Fassade wird mit aktueller Policy aufgebaut. Der Akteur wird vor verzögerter
Query-Ausführung und Prisma-Transaktionscallbacks erfasst und ausdrücklich
weitergegeben. Ohne vertrauenswürdigen Kontext bleibt UNKNOWN / unscoped-prisma.
Neue Jobs/Webhooks müssen nach ihrer Authentizitätsprüfung withAuditContext mit
SYSTEM und einer festen Herkunft setzen. Keine globale mutable User-ID.
Zeitpunkte sind Erfassungszeitpunkte, keine garantierten Commit-Zeitpunkte.

## Anzeige und Berechtigungen

Unter Administration erscheint „Audit“ ausschließlich für Plattform-ADMIN.
Die Route `/admin/audit` autorisiert unabhängig serverseitig mit requireAdmin
und zeigt alle Companies. Direkter URL-Aufruf durch Company-Admins/-User
gewährt keinen Zugang.

Die graue Tabelle in `components/audit-table.tsx` wird gemeinsam von Admin-
Übersicht und Reihenhistorie verwendet. Spalten: Timestamp, Wer?, Was?, optional
Zielobjekt (Modell, Nummer, Name), Details. Details zeigen eine kommagetrennte
Attributliste; ein kleiner Pfeil öffnet das formatierte before/after-JSON.
Je Seite werden 20 Einträge geladen, sortiert nach Zeitpunkt und ID.

Die aktuelle Akteur-E-Mail wird über actorUserId nachgeladen und nur angezeigt,
nicht in AuditLog kopiert. Bei gelöschten Akteuren bleibt die ID als Ersatz.
Die Reihenhistorie unter
`/company/[companyKey]/event-series/[seriesId]` behält requireCompanyAccess,
Company-Filter und Datensatzzugehörigkeitsprüfung. Sie zeigt nur EventSeries
dieser Company. Andere Detailseiten erhalten in dieser Änderung keine Historie.
Gelöschte Objekte bleiben in der Admin-Historie sichtbar.

## Schutz, Migration und offene Punkte

AuditLog-Writes (auch Create) sind über die Anwendungsfassade gesperrt.
Nur der interne Executor schreibt über seinen nicht exportierten Basis-
Transaktionsclient. Keine Selbst-Auditierung. Kein automatisches Löschen;
Aufbewahrung und spätere kontrollierte Bereinigung sind fachlich festzulegen.

Es wurden keine Migrationsdateien erzeugt/geändert, keine Migration ausgeführt,
keine Pakete installiert und keine Tests gestartet. Für die beiden neuen
optionalen Zielidentitätsfelder muss selbst eine Migration erzeugt werden:

```powershell
npx prisma migrate dev --create-only --name extend_audit_target_identity
```

Dieser Befehl erzeugt eine Migration für die konfigurierte Entwicklungsdatenbank,
ohne sie anzuwenden. Vor Nutzung die Migration prüfen/anwenden und den Prisma-
Client generieren. Ohne die neuen Spalten schlagen Audit-Reads/Writes fehl;
fachliche auditpflichtige Änderungen rollen zurück. Vorhandene initiale Audit-
Migrationen bleiben unverändert. Keine Datenbank zurücksetzen.

Es gibt weiterhin keinen AuditLog-Schutztrigger und keine neuen Datenbankrechte.
Direkter SQL-Zugriff oder ein separat erzeugter Client kann AuditLog verändern.
Später können INSERT/SELECT-Laufzeitrolle ohne Ownerrechte und UPDATE/DELETE/
TRUNCATE-Schutz nach dem vorhandenen Voucher-Journalmuster ergänzt werden.
Privilegierte Datenbankadministratoren könnten auch diese Schutzmaßnahmen ändern.

Statische Typ-/Lintprüfungen belegen keine Datenbankatomarität. Vor produktiver
Freigabe: PostgreSQL-Integrationsprüfung von Rollback (auch abgefangener
Auditfehler), Bulk/Upsert, nested Writes, Kaskaden, parallelen Zugriffen,
Akteurkontext, Admin-/Company-Abgrenzung und Datenschutz. Keine rückwirkende
Rekonstruktion bisher nicht protokollierter Änderungen.
