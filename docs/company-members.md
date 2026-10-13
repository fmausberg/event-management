# Company-Mitglieder

Unter `/admin/companies` führt die Mitgliederanzahl nach
`/company/<company-slug>/members`. Diese Seite und ihre Server Action erlauben
Zugriff ausschließlich für globale `ADMIN`-Benutzer oder eine aktive
`COMPANY_ADMIN`-Mitgliedschaft in genau dieser Company. Rollen werden bei jedem
Zugriff aus der Datenbank gelesen.

Mitglieder werden über eine normalisierte E-Mail-Adresse hinzugefügt, stets mit
der Rolle `COMPANY_USER`. Bestehende Accounts werden direkt zugeordnet. Ohne
Account entsteht eine Mitgliedschaft mit `email`, ohne `userId` und mit Status
`ACTIVE`; es wird kein künstlicher Benutzer angelegt und keine E-Mail versendet.
Die Mitgliederanzahl enthält auch diese vorgemerkten Mitgliedschaften.

Der angezeigte **Kontostatus** ist vom internen Mitgliedschaftsstatus unabhängig:

- `no account`: kein zugehöriger Account vorhanden.
- `not verified`: Account vorhanden, `User.emailVerified` leer.
- `verified`: Account mit gesetztem `User.emailVerified`.

Auch nach einer späteren Registrierung wird der Kontostatus anhand der Adresse
aktuell ermittelt. Die nächste Session-Prüfung ordnet die Mitgliedschaft anhand
der normalisierten E-Mail dem Account zu, unabhängig von `emailVerified`.
Bestehende Rollen und gesperrte Mitgliedschaften werden dabei nicht
überschrieben. Mehrdeutige alte Accounts mit gleicher Adresse in unterschiedlicher
Schreibweise werden nicht automatisch zugeordnet. Der bisherige Platzhalter für
die E-Mail-Verifizierung bleibt bestehen; dieses Feature ergänzt keinen Versand
und keinen Verifizierungsprozess.

Diese gewünschte Zuordnung vertraut der registrierten E-Mail-Adresse ohne
Besitznachweis. Wer sich mit einer bereits zugeordneten fremden Adresse
registriert, kann dadurch deren Company-Zugriff erhalten.

Die Datenmigration `20261013120000_activate_company_memberships` setzt bisherige
`INVITED`-Mitgliedschaften auf `ACTIVE`. `SUSPENDED` bleibt unverändert.
Der alte Enum-Wert bleibt zur Kompatibilität erhalten, wird beim Hinzufügen aber
nicht mehr verwendet. Der Kontostatus ist nur eine Anzeige, keine Zugriffshürde.

## Datenbankschema

`CompanyMembership.userId` und dessen Relation sind nun optional. Das neue
optionale Feld `email` besitzt einen Unique-Index zusammen mit `companyId`.
Bestehende Mitgliedschaften behalten ihre Benutzerrelation; deren E-Mail wird
weiterhin aus dem Benutzerkonto gelesen. Es ist kein Backfill nötig.

Die Migration `20261012212000_company_members_without_account` ergänzt die
E-Mail-Spalte und den Unique-Index und macht `userId` optional. Sie wurde nach
Freigabe auf die lokale Datenbank angewendet; der Prisma Client wurde neu erzeugt.
In weiteren Umgebungen muss sie vor Nutzung mit `prisma migrate deploy`
angewendet werden. Bestehende Mitgliedschaften bleiben erhalten.

Die Tests verwenden Datenbank-Doubles und prüfen unter anderem Zugriffsrechte,
Normalisierung, doppelte Zuordnungen, Kontostatus und die sichere Übernahme
vorgemerkter Mitgliedschaften.

Der Routenparameter `companyKey` bezeichnet den eindeutigen `Company.slug`.
Datenzugriffe und Berechtigungspr?fungen verwenden nach dessen Aufl?sung die
interne Company-ID. ?nderungen am Slug ?ndern auch die Verwaltungs-URLs; alte
URLs werden nicht automatisch weitergeleitet.
