# Betrieb mit Docker

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

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.traefik.yaml -p event-management up -d --build
```

Bei diesem Aufbau dieselben `--env-file`-, `-f`- und `-p`-Optionen auch bei
den übrigen Compose-Befehlen verwenden.

`.github/workflows/deploy.yml` reagiert auf Pushes nach main. Der Workflow
verbindet sich per SSH, führt `git pull --ff-only origin main` aus und startet
Compose mit beiden Dateien. Er verwendet das Secret DEPLOY_SSH_KEY und die
Repository-Variablen DEPLOY_HOST, DEPLOY_USER und DEPLOY_PATH. Der Env-Dateipfad
ist dort fest auf `/opt/docker/event-management/.env.docker` gesetzt.
Der Workflow enthält keine automatischen Tests oder Backup-Schritte;
[Prüfungen](testing.md) vor einer Freigabe gesondert ausführen.

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
