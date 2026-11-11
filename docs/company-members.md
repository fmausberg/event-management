# Company-Mitglieder

## Interne E-Mail-Benachrichtigungen

Aktive Company-User können die Mitgliederseite und Benachrichtigungseinstellungen
lesen. Änderungen bleiben globalen Admins und aktiven Company-Admins vorbehalten.
Pro Mitglied lassen sich Buchungen und Stornierungsanfragen unabhängig speichern.
Stornierungsbenachrichtigungen umfassen neue Anfragen, Entscheidungen und
Refund-Ergebnisse einschließlich fehlgeschlagener Refunds.

Die Migration `20261111150000_company_member_notifications` ergänzt beide
Einstellungen als `NOT NULL DEFAULT true`: bestehende und neue Mitgliedschaften
starten mit aktivierten Optionen. Sie muss vor dem neuen Anwendungscode angewendet
werden; anschließend den Prisma-Client mit `npx prisma generate` aktualisieren.

Interne Empfänger müssen ACTIVE sein, die jeweilige Option aktiviert haben und
mit einem User mit gesetztem `emailVerified` verknüpft sein. Die Prüfung erfolgt
beim Einreihen und erneut direkt vor jedem Versandversuch. Adressen werden ohne
Beachtung der Groß-/Kleinschreibung dedupliziert. Kundenmails sind davon unabhängig.

Buchungsbenachrichtigungen werden bei bestätigten Direktbuchungen und neuen
bestätigten Plattformbuchungen atomar in die vorhandene `MailOutbox` eingereiht.
Nach dem Commit versucht der Versandweg der Kundenbestätigung auch die internen
Mails derselben Buchung sofort zuzustellen. Fehler bei internen Mails beeinflussen
die Kundenbestätigung nicht. Der bestehende Reconcile-Endpunkt
`/api/payments/reconcile` übernimmt ausstehende Mails und Wiederholungen mit dem
gemeinsamen Retry-/Lease-Mechanismus. Stornierungen nutzen weiterhin
`CancellationMail`. Es ist keine zusätzliche Queue erforderlich.

Unter `/admin/companies` führt die Mitgliederanzahl nach
`/company/<company-slug>/members`. Globale ADMINs und aktive COMPANY_ADMINs
dieser Company dürfen Mitglieder hinzufügen, Rollen ändern und nach Bestätigung
Mitgliedschaften entfernen. Jede Aktion prüft die aktuellen Datenbankrechte.

## Hinzufügen und Kontozuordnung

E-Mail-Adressen werden normalisiert. Neue Mitgliedschaften erhalten
COMPANY_USER und ACTIVE. Bereits verifizierte Accounts werden direkt verknüpft.
Ohne verifizierten Account bleibt `userId` leer und die Adresse wird an der
Mitgliedschaft gespeichert; es wird kein künstlicher Benutzer angelegt.

Beim Anlegen wird eine Zuordnungsbenachrichtigung versucht. Sie enthält den
normalen Registrierungslink und gewährt selbst keine Rechte. Ein Mailfehler
entfernt die Mitgliedschaft nicht. Die Benachrichtigung kann erneut gesendet werden.

Offene Mitgliedschaften werden erst nach E-Mail-Bestätigung mit dem Account
verknüpft; dieselbe Prüfung erfolgt bei späteren Session-Prüfungen erneut.
Mehrdeutige Account-Adressen, bereits fremd verknüpfte Zuordnungen und
suspendierte Mitgliedschaften werden nicht übernommen. Bestehende Rollen bleiben
erhalten. Ablauf und weitere Zuordnungstypen: [Verifizierung](email-verification.md).

## Angezeigter Kontostatus

| Anzeige | Bedeutung |
| --- | --- |
| no account | Kein eindeutig zugehöriger Account |
| not verified | Account vorhanden, E-Mail noch nicht bestätigt |
| verified | Account mit bestätigter E-Mail |

Der Kontostatus wird aus den aktuellen Accountdaten ermittelt und ist vom
Mitgliedschaftsstatus getrennt. ACTIVE allein verschafft einem unbestätigten,
noch nicht verknüpften Account keinen Zugriff.

## Datenmodell und URLs

`CompanyMembership.userId` ist optional. Für die vorgemerkte Adresse gibt es
einen Unique-Index zusammen mit `companyId`. Verknüpfte Mitgliedschaften lesen
die angezeigte Adresse aus dem Benutzerkonto.

Die Migrationen `20261012212000_company_members_without_account` und
`20261013120000_activate_company_memberships` sind Teil der eingecheckten
Migrationshistorie. Letztere setzt historische INVITED-Zuordnungen auf ACTIVE;
SUSPENDED bleibt erhalten. Den angewendeten Stand je Datenbank prüfen.

`companyKey` bezeichnet `Company.slug`. Nach dessen Auflösung verwenden
Datenzugriffe die interne Company-ID. Slug-Änderungen ändern Verwaltungs-URLs;
alte URLs werden nicht automatisch weitergeleitet.

Tests prüfen Berechtigungen, Normalisierung, doppelte Zuordnungen, Kontostatus
und die verifizierte Übernahme mit Datenbank-Doubles; siehe [Prüfungen](testing.md).
