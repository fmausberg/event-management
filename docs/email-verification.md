# Verifizierte Konten und offene Zuordnungen

Registrierung legt `emailVerified = null` an. Auch bestehende unbestätigte Konten
können sich erst nach der Bestätigung anmelden; vorhandene JWT-Sitzungen werden
bei fehlender Bestätigung nicht weiter akzeptiert. OAuth-Neukonten erhalten
ebenfalls eine separate Verifizierungs-Mail. Bestehende bestätigte Konten behalten
ihre Anmeldemethode; OAuth verknüpft keine fremden Konten automatisch.

Unter `/verify-email` kann eine neue Mail angefordert werden. Der zufällige Token
ist 24 Stunden gültig, wird nur als SHA-256-Hash in `VerificationToken` gespeichert
und einmalig per Server Action eingelöst. Er ist an User-ID und E-Mail gebunden.
Der Link enthält den Token im URL-Fragment; erst der Bestätigungsbutton auf der
Seite führt die Aktion aus. Mail-Linkscanner lösen damit keine Verifizierung aus.

In derselben serialisierbaren Transaktion werden E-Mail-Bestätigung, Tokenverbrauch
und offene Company-Mitgliedschaften, Event-Staff-, Venue-Staff- und Trainerprofile
verknüpft. Mehrdeutige Account-Adressen werden nicht zugeordnet. Bereits fremd
verknüpfte Profile, vorhandene Rollen und suspendierte Mitgliedschaften werden
nicht überschrieben. Mehrere Trainerprofile in verschiedenen Companies sind erlaubt.
Bei bestätigten Konten wird die Verknüpfung beim Login erneut versucht, etwa wenn
eine neue Zuordnung während der Verifizierung gespeichert wurde.

Eintragungs-Mails enthalten ausschließlich den normalen Registrierungslink,
Company, Rolle und Absender; bei Staff zusätzlich Veranstaltung bzw. Venue.
Sie gewähren keine Rechte. Scheitert SMTP, bleibt die Zuordnung bestehen. In den
Staff-, Trainer- und Mitgliedertabellen kann die Benachrichtigung erneut gesendet
werden. Für Trainer und Mitglieder nennt ein erneuter Versand den versendenden
Verwalter; bei Staff bleibt der ursprüngliche Eintragende gespeichert.

Konfiguration: `AUTH_URL` als öffentliche HTTPS-Adresse (lokal HTTP localhost)
und die bestehenden `SMTP_*`/`MAIL_FROM_*`-Variablen. `MAIL_TEST_RECIPIENT` leitet
auch Verifizierungs-Mails um und darf in Produktion nicht auf eine Testadresse zeigen.
Resend ist begrenzt. Antworten verraten nicht, ob eine eingegebene Adresse ein
unbestätigtes Konto besitzt. Es werden keine Tokens oder SMTP-Antworten geloggt.

Es wird die bestehende Tabelle `VerificationToken` verwendet; keine neue Migration.
