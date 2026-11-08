# Betrieb mit Docker

Optionale Eventbrite-Organisationsverknüpfung: `EVENTBRITE_CLIENT_ID`,
`EVENTBRITE_CLIENT_SECRET`, `EVENTBRITE_REDIRECT_URI` und
`EVENTBRITE_TOKEN_ENCRYPTION_KEY` zur Laufzeit in `.env.docker` setzen.
Einrichtung, HTTPS-Callback und erforderliche Migration: [Eventbrite](eventbrite.md).

Voraussetzungen: Linux-Server mit Docker Engine und Compose v2, Domain und
HTTPS-Reverse-Proxy. Das Repository enthält ein Traefik-Overlay;
alternativ kann ein eigener Proxy verwendet werden. Der App-Port wird ausschließlich an
`127.0.0.1` gebunden; PostgreSQL ist nur im internen Compose-Netz erreichbar.

## Erster Start

```sh
cp .env.docker.example .env.docker
openssl rand -hex 32
openssl rand -hex 32
```

Die beiden unterschiedlichen Werte als `POSTGRES_PASSWORD` und `AUTH_SECRET`
eintragen. Das Datenbankpasswort muss URL-sicher sein; Hex-Werte erfüllen das.
`AUTH_URL` auf die echte öffentliche HTTPS-Adresse setzen. `.env.docker` bleibt
außerhalb von Git und Docker-Image. Keine produktiven Secrets als Build-Argumente
übergeben. Die Datenbank-URL erzeugt Compose aus dem Passwort und dem Host `db`.

Zusätzlich ist `TICKET_CODE_ENCRYPTION_KEYS` erforderlich. Einen eigenen zufälligen
32-Byte-Schlüssel erzeugen und als JSON-Keyring eintragen; vollständiges Format und
Rotation siehe [Ticketcodes](ticket-codes.md). Compose bricht bei fehlendem Wert ab.
Für die Gutschein-Domänenschicht zusätzlich `VOUCHER_CODE_DIGEST_KEYS` als
JSON-Schlüsselring konfigurieren; Format, Erzeugung und Rotation siehe
[Gutscheine](vouchers.md#schlüssel-und-geheimnisse). Compose reicht die Variable
nur zur Laufzeit an `app` weiter. Fehlende oder ungültige Werte werden beim
Gutscheinzugriff abgelehnt; sie verhindern nicht den Start anderer App-Funktionen.
Die Platzhalter in den Env-Beispielen sind absichtlich keine gültigen Schlüssel.
SMTP für Verifizierung/Tickets und bei Bedarf Stripe/Cloudinary konfigurieren.
`PAYMENTS_CRON_SECRET` wird für den regelmäßig aufzurufenden Abgleich benötigt.

Für einen lokalen Start aus dem Quellcode:

```sh
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps -a
docker compose --env-file .env.docker logs --tail=100 app migrate
curl --fail http://127.0.0.1:3000/api/health
```

Compose wartet auf PostgreSQL, führt `prisma migrate deploy` im separaten
Migrationscontainer aus und startet die App nur bei erfolgreicher Migration.
Der Prozess im App-Container läuft als Benutzer `node`. `/api/health` prüft die
Datenbankverbindung und gibt bei Fehlern HTTP 503 ohne interne Details zurück.
Die erstmalige Image-Erstellung benötigt Netzwerkzugriff für npm und die über
`next/font` eingebundenen Google Fonts.

Für einen lokalen Docker-Test `AUTH_URL=http://localhost:3000` setzen; ist der
Port belegt, zusätzlich `APP_PORT=3001` und `AUTH_URL=http://localhost:3001`.
Für produktiven Betrieb HTTPS verwenden.

## Reverse Proxy

Beispiel für Caddy **auf dem Host** (Domain anpassen):

```caddyfile
events.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Den Hostnamen auf den Server zeigen lassen und Ports 80/443 für den Proxy öffnen.
Der Proxy muss den öffentlichen Host und das ursprüngliche HTTPS-Schema korrekt
weitergeben. `AUTH_URL` muss mit dieser Adresse übereinstimmen. Läuft dein Proxy
selbst in Docker, muss er stattdessen im App-Netzwerk `app:3000` erreichen können;
`127.0.0.1` im Proxy-Container bezeichnet nicht den Host.

OAuth ist optional. Zugangsdaten in `.env.docker` eintragen und beim Anbieter
`https://DEINE-DOMAIN/api/auth/callback/google` bzw. `/github` freigeben.
Dasselbe `AUTH_SECRET` auch bei Updates beibehalten (Sessions und Buchungsformulare).

## Bestehende Daten

Das Volume `postgres_data` wird beim ersten Start leer angelegt. Lokale
Entwicklungsdaten werden **nicht** automatisch übertragen. Für die Übernahme
einen PostgreSQL-Dump inklusive `_prisma_migrations` erstellen und in eine leere
Zieldatenbank wiederherstellen, bevor `migrate` und `app` gestartet werden.
Bei bestehenden Daten vor jeder Migration ein geprüftes Backup erstellen.
Keine `migrate dev`-, `db push`- oder Reset-Befehle für den Server verwenden.

Neue Benutzer haben standardmäßig keine globalen Adminrechte. Nach der
Registrierung den ersten Admin bei Bedarf gezielt per SQL in der Serverdatenbank
setzen (Adresse anpassen, keine automatische Adminvergabe):

```sh
docker compose --env-file .env.docker exec db psql -U event_management -d event_management
```

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'deine-adresse@example.com';
```

## Updates und Backups

Vor dem Update einen Dump erstellen (Bash auf dem Linux-Server):

```sh
mkdir -p backups
docker compose --env-file .env.docker exec -T db pg_dump -U event_management -d event_management -Fc > backups/event-management.dump
docker compose --env-file .env.docker build app migrate
docker compose --env-file .env.docker stop app
docker compose --env-file .env.docker run --rm migrate
# Nur fortfahren, wenn die Migration erfolgreich war:
docker compose --env-file .env.docker up -d --force-recreate app
```

Backups zusätzlich außerhalb des Servers aufbewahren und Wiederherstellung
testen. `docker compose down` erhält das Volume; **`down -v` löscht es**.
Passwortänderungen in der Env-Datei ändern das Passwort einer bereits
initialisierten PostgreSQL-Datenbank nicht automatisch.

## Aufbau und Prüfung

Das mehrstufige Dockerfile installiert per Lockfile, erzeugt den Prisma Client
und baut Next.js als `standalone`. Laufzeitimage und Migrationsimage sind getrennt.
Für parallele lokale Build-Prüfungen kann `NEXT_BUILD_DIR=.next-check` gesetzt
werden; das Dockerfile nutzt regulär `.next`.

Die ehemals unvollständige globale Event-Erstellung unter `/admin/events/new`
führt zur Company-Auswahl. Events werden dort über die vorhandene vollständige
Company-Eventverwaltung mit Preis und Company-Zuordnung angelegt.

Compose-Startreihenfolge: https://docs.docker.com/compose/how-tos/startup-order/

## Traefik und GitHub-Deployment

`compose.traefik.yaml` verbindet die App mit dem externen Netzwerk `web`.
Es erwartet einen vorhandenen Traefik mit EntryPoints `web` und `websecure`
sowie dem Zertifikatsresolver `myresolver`. Die Host-Regel enthält
`events.mausberg.net`; für eine andere Domain Labels und AUTH_URL anpassen.

`.github/workflows/deploy.yml` reagiert auf Pushes nach `main` und kann auch
manuell gestartet werden. GitHub Actions baut zwei Images: das App-Image und
das Prisma-Migrationsimage. Beide werden mit dem Commit-SHA als Tag in GHCR
veröffentlicht. Anschließend verbindet sich der Workflow per SSH mit dem Server,
holt den aktuellen Compose-Stand und lässt Compose die Images ziehen und starten.
Der Produktionsserver führt dabei keinen Docker-Build aus.

Der Workflow verwendet das Secret `DEPLOY_SSH_KEY` und die Repository-Variablen
`DEPLOY_HOST`, `DEPLOY_USER` und `DEPLOY_PATH`. Der Env-Dateipfad ist fest auf
`/opt/docker/event-management/.env.docker` gesetzt. In GitHub Actions muss
`GITHUB_TOKEN` die Berechtigung `packages: write` haben; das ist im Workflow
bereits gesetzt. Keine Produktiv-Secrets als Build-Argumente oder Image-Inhalt
hinterlegen.

### Einmalige GHCR-Anmeldung auf dem Server

GHCR-Pakete sind beim ersten Veröffentlichen standardmäßig privat. Wenn die
Images privat bleiben, muss sich derselbe Linux-Benutzer, der Docker und den
Deploy-Workflow ausführt, einmal auf dem Server anmelden. Erzeuge dafür auf
GitHub ein **Personal Access Token (classic)** mit ausschließlich
`read:packages`. Führe auf dem Server als Deploy-Benutzer aus:

```sh
read -rsp "GitHub read:packages token: " GHCR_TOKEN
printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username fmausberg --password-stdin
unset GHCR_TOKEN
```

Docker speichert die Anmeldung in der Benutzerkonfiguration. Bei einem Root-Deploy
liegt sie unter `/root/.docker/config.json`; das Token nicht in GitHub-Workflow-
Dateien oder in die Compose-Datei schreiben. Alternativ können die GHCR-Pakete
öffentlich gestellt werden; dann ist für den Image-Pull keine Anmeldung nötig.
Da dieses Repository öffentlich ist, würde das Image in diesem Fall ebenfalls
öffentlich abrufbar sein.

Nach dem Merge kontrolliere in GitHub unter **Actions**, dass der Lauf für
`main` erfolgreich abgeschlossen wurde. Bei einem Fehler auf dem Server zuerst
`docker compose ... logs --tail=100 migrate app` ansehen. Nach erfolgreichem Start
entfernt der Workflow ungenutzte App- und Migrationsimages dieses Projekts vom
Server, darunter die alten lokalen `event-management-*:latest`-Images. Er prüft
zuerst, ob ein Container ein Image noch verwendet. Images anderer Projekte auf
dem Server bleiben davon unberührt. GHCR-Tags auf GitHub werden durch diese
Serverbereinigung nicht gelöscht. Der Workflow enthält keine automatischen Tests
oder Backup-Schritte; [Prüfungen](testing.md) vor einer Freigabe gesondert ausführen.

Der Compose-Migrationsservice wendet ausstehende Migrationen vor dem App-Start an.
Für Änderungen, die einen koordinierten Stopp benötigen, gelten zusätzlich die
Wartungsschritte in [Ticket-Outbox](ticket-outbox.md) und
[Ticketcodes](ticket-codes.md); ein gewöhnlicher Rolling-Parallelbetrieb ist dafür
nicht ausreichend.

## Regelmäßiger Abgleich

Ein externer Scheduler muss `POST /api/payments/reconcile` mit
`Authorization: Bearer <PAYMENTS_CRON_SECRET>` regelmäßig (empfohlen jede Minute)
aufrufen. Compose und der GitHub-Workflow richten diesen Scheduler nicht ein.
Er verarbeitet offene Zahlungen, Erstattungen, Ticket- und Stornierungsmails sowie
fällige Trainer-Reminder für Events, die in höchstens einer Stunde beginnen.
Er ist auch für kostenlose Events mit fehlgeschlagenem Mailversand erforderlich.
Details: [Stripe](stripe.md), [Ticket-Outbox](ticket-outbox.md),
[Trainer-Reminder](trainer-reminders.md) und [Stornierungen](cancellations.md).
