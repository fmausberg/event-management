# HTML-Beschreibungen lokal testen

`Event.description` und `EventSeries.description` enthalten nach der Migration ausschließlich HTML. Kurzbeschreibungen bleiben Klartext. Die gemeinsamen Tiptap-Editoren erlauben Absätze, Zeilenumbrüche, Fett, Kursiv, Unterstreichen und beide Listenarten. Beim Speichern bereinigt `sanitize-html` die Beschreibung serverseitig; es sind keine Attribute erlaubt. Kopieren und Vererben übernehmen HTML direkt, ohne erneutes Escaping. Die aktuellen E-Mail-Vorlagen verwenden diese Beschreibungen nicht. Für künftige reine Textausgaben steht `descriptionToText` bereit.

## Migration

Zuerst `DATABASE_URL` auf die gewünschte lokale Datenbank setzen (die Prisma-Konfiguration lädt `.env.local` vor `.env`). Dann:

```powershell
npx prisma migrate deploy
npm run dev
```

`migrate deploy` führt alle ausstehenden Migrationen aus und protokolliert sie in `_prisma_migrations`. Die Datenmigration `20261104120000_description_html` konvertiert nur die beiden Beschreibungsspalten; auch vorhandene `<p>`-Zeichenfolgen werden als Text escaped. `null` und leere Strings bleiben erhalten. Kein Reset und keine heuristische HTML-Erkennung bei der Ausgabe.

## Manuelle Prüfung

1. Vorhandene mehrzeilige Beschreibung nach der Migration öffnen: Absätze, Umbrüche und Sonderzeichen müssen erhalten bleiben. Ein bisher wörtliches `<p>` muss weiterhin als Text sichtbar sein.
2. Event und Eventreihe erstellen und bearbeiten. Text markieren und alle fünf Formatierungen per Maus sowie Tastatur anwenden. Enter erzeugt einen Absatz, Shift+Enter einen Zeilenumbruch. Speichern und erneut öffnen.
3. Inhalte aus Word oder einer Webseite einfügen. Nach dem Speichern dürfen keine fremden Farben, Klassen, Bilder oder Links übrig bleiben.
4. Beschreibung leeren, auch mit Leerzeichen oder leeren Absätzen. Entwurf bleibt speicherbar; beim Veröffentlichen greift weiterhin die optionale Beschreibungshinweismeldung.
5. Reihe in Event übernehmen, Event duplizieren und mehrere Termine erstellen. Formatierungen müssen erhalten bleiben. Reihenbeschreibung ändern, Vorher/Nachher-Vorschau prüfen und für ausgewählte Termine übernehmen.
6. Öffentliche Eventseite und Reihendetail prüfen. Kurzbeschreibungen müssen weiterhin normale Textfelder sein.

Die gezielten Tests in `tests/description-html.test.ts` prüfen auch die tatsächliche SQL-Migration in einer isolierten PGlite-Instanz im Speicher, ohne Verbindung zur konfigurierten Projektdatenbank.
