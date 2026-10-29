# Cloudinary-Titelbilder für Events

## Einrichtung

Im Cloudinary-Konto `tickets@mausberg.net` unter **Settings → API Keys** den
Cloud Name, API Key und API Secret der gewünschten Produktumgebung abrufen.
Diese drei Werte gehören ausschließlich in serverseitige Umgebungsvariablen:

```dotenv
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
```

Lokal `.env.local` oder `.env` verwenden und den Entwicklungsserver neu starten.
Für Docker die Werte in `.env.docker` setzen und die App neu erstellen/starten;
`compose.yaml` reicht die Variablen an den App-Container weiter. Niemals
`NEXT_PUBLIC_` für das API Secret verwenden. Es wird kein Unsigned Upload Preset
benötigt: Die Uploads laufen mit signierten SDK-Aufrufen ausschließlich serverseitig.

Die Migration `20261015210000_event_cover_image` fügt zwei optionale Event-Felder
hinzu. Beim Deployment `npx prisma migrate deploy` ausführen; der bestehende
Docker-Migrationsservice erledigt dies bereits vor dem App-Start.

## Bedienung

Company User, Company Admins und globale Admins können im Veranstaltungs- und Eventserienformular
ein Titelbild auswählen, ersetzen oder entfernen. JPEG, PNG und WebP bis 8 MB
werden akzeptiert. Die Vorschau zeigt den mittigen 16:9-Ausschnitt. Cloudinary
speichert eine auf 1600 × 900 Pixel zugeschnittene JPEG-Version. Hochformatbilder
werden entsprechend beschnitten; empfohlen sind mindestens 1600 × 900 Pixel.

Erst **Entwurf speichern**, **Speichern** oder **Veröffentlichen** lädt das Bild
hoch und verknüpft es mit dem Event. **Abbrechen** lädt nichts hoch. **Absagen**
ändert nur den Eventstatus und übernimmt auch keine Bildänderungen.

Der Ordner heißt `events_pictures`. Bei dynamischen Cloudinary-Ordnern wird
`asset_folder=events_pictures` gesetzt; die eindeutige Public ID enthält zusätzlich
die serverseitig ermittelte Company-ID und eine zufällige UUID. Bei festem
Ordnermodus bildet dieser Public-ID-Pfad Unterordner innerhalb `events_pictures`.
Bestehende Dateien werden niemals überschrieben.

Beim Erstellen aus einer Eventserie wird deren Bild-URL in das Event kopiert.
Ein eigener Upload hat Vorrang. Bestehende Events behalten ihre gespeicherte URL,
solange das neue Serienbild nicht ausdrücklich über die
[Serienvorschau](events-and-series.md) für das jeweilige Event übernommen wird. Die Datenmigration
`20261015214000_copy_series_cover_to_events` kopiert bisher nur indirekt angezeigte
Serienbilder einmalig in bestehende Events. Beim Deployment Migrationen anwenden.
Nach dem Entfernen einer Event-Bildreferenz erscheint kein Serienbild automatisch.

## Grenzen und Fehlerbehandlung

- Rechte und Company-Zugehörigkeit werden vor dem Upload sowie beim Speichern geprüft.
- Dateityp, Dateisignatur und Größe werden serverseitig geprüft; Client-URLs und
  Public IDs werden nicht als vertrauenswürdige Eingabe akzeptiert.
- Entfernen und Ersetzen eines Titelbilds sowie das Entfernen eines Events oder
  einer Serie entfernt nur die Datenbankreferenz. Bereits gespeicherte Dateien
  bleiben in Cloudinary erhalten, da andere Events dieselbe URL verwenden können.
- Nur neue, noch nicht gespeicherte Uploads werden bei einem fehlgeschlagenen
  Speichervorgang bereinigt. Scheitert diese Bereinigung, steht die Public ID im
  Serverlog. Es gibt keinen automatischen Bereinigungsjob.
- Der Reverse Proxy muss mindestens 12 MB Request-Größe erlauben. Die Anwendung
  akzeptiert maximal 8 MB pro Bild; Server Actions sind auf 12 MB begrenzt.
- Ohne konfigurierte Zugangsdaten können Events weiter ohne neue Bilder gespeichert
  werden. Neue Uploads zeigen dann eine verständliche Fehlermeldung.

Referenzen: [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference),
[Transformationen beim Upload](https://cloudinary.com/documentation/upload_parameters).
