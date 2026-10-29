# Trainerverwaltung

Trainer werden pro Company mit Vorname, Nachname und E-Mail-Adresse verwaltet.

- Im Company-Menü führt **Trainer** zu `/company/[companyKey]/trainers`.
- Unter `/admin/trainers` gibt es dieselbe Verwaltung mit Company-Auswahl. Globale Admins sehen alle Companies, andere Benutzer ausschließlich ihre aktiven Mitgliedschaften.
- Aktive `COMPANY_USER` und `COMPANY_ADMIN` können Trainer ihrer Company anlegen, bearbeiten und löschen. Jede Server Action prüft den Zugriff erneut; Company-Zuordnung und erlaubte Datenfelder werden serverseitig festgelegt.
- E-Mail-Adressen werden getrimmt und kleingeschrieben. Die Kombination aus Company und E-Mail ist eindeutig; dieselbe Adresse ist in verschiedenen Companies erlaubt.
- Die Tabelle lässt sich nach Nummer, Vorname, Nachname und E-Mail durchsuchen. Sie zeigt auch die Anzahl bestehender Event- und Serienzuordnungen.
- Löschen erfordert eine Bestätigung und ist nur ohne Event- oder Serienzuordnungen möglich. Event-Verknüpfungen sind zusätzlich durch den vorhandenen Foreign Key geschützt.

Die Verwaltung nutzt das `Trainer`-Modell und die Migration `20261015100202_add_trainer_model`. Trainer können ohne Benutzeraccount angelegt werden. Zuordnungsbenachrichtigungen können versendet werden. Die Verknüpfung mit einem Account setzt dessen bestätigte E-Mail voraus; Ablauf und Neuversand beschreibt [Verifizierung](email-verification.md).

Event- und Serienformulare bieten eine Company-bezogene Trainerauswahl. Events können mehrere Trainer über `EventTrainer` verknüpfen; Serien verwenden `suggestedTrainerId` als einzelne Vorgabe. Bei Auswahl einer Serie wird diese Vorgabe ins Event übernommen. Spätere Serienänderungen können ausgewählte Attribute zukünftiger Events über die [Serienvorschau](events-and-series.md) aktualisieren.

Über **Neuen Trainer anlegen** können Vorname, Nachname und E-Mail direkt im Formular erfasst werden. **Anlegen und auswählen** speichert den Trainer sofort und übernimmt ihn in die Auswahl, ohne die übrigen Eingaben zu verlieren. Der neue Trainer bleibt erhalten, wenn das Event- oder Serienformular anschließend abgebrochen wird.

Neue Speichervorgänge verwenden ausschließlich Trainer-IDs und prüfen deren Company-Zugehörigkeit serverseitig. Eventänderungen und Zuordnungen werden gemeinsam in einer Transaktion gespeichert. Auf öffentlichen Eventseiten werden die aktuellen Namen der verknüpften Trainer angezeigt; ihre E-Mail-Adressen werden dort nicht abgefragt.

Alte Freitextnamen bleiben bis zur Bearbeitung als Anzeige erhalten. Im Formular weist ein Hinweis darauf hin, dass beim Speichern die Trainerauswahl den Freitext ersetzt (eine leere Auswahl entfernt ihn). Es erfolgt keine automatische Umwandlung, weil Namen allein keine eindeutige Zuordnung und keine gültige Trainer-E-Mail ermöglichen. Die vorhandene Trainer-Migration reicht aus; zusätzliche Schemaänderungen sind nicht erforderlich.
