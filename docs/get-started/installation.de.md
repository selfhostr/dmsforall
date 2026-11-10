---
title: dmsforall auf einem Server installieren
description: dmsforall mit einer einzigen Compose-Datei installieren, einen eigenen Reverse Proxy für HTTPS auf einer Domain davorsetzen und die Installation prüfen.
---

Diese Seite behandelt eine Installation auf einem Server. Die [Schnellstart](quick-start.md)-Anleitung gibt die Kurzfassung.

Am Ende dieser Seite läuft der Stack auf Ihrem Server, gegebenenfalls hinter Ihrem HTTPS-Reverse-Proxy, und Sie haben geprüft, dass er antwortet.

## Voraussetzungen

- Docker Engine und Docker Compose 2.24 oder neuer.
- Speicherplatz für die Datenbank, die hochgeladenen Dokumente und die Sicherungen.
- Für einen Domainnamen mit echtem Zertifikat: ein eigener Reverse Proxy (Caddy, nginx, Traefik, ein Cloudflare-Tunnel).

## Installieren

Erstellen Sie einen leeren Ordner, laden Sie die Compose-Datei hinein und starten Sie den Stack. Diese Datei ist alles, was Sie brauchen. Sie legen keine weitere Datei und keinen Unterordner an.

```sh
mkdir dmsforall && cd dmsforall
curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
docker compose up -d
```

Öffnen Sie `https://<Serveradresse>:8443`. dmsforall veröffentlicht einen einzigen Port, nur in HTTPS, mit einem selbstsignierten Zertifikat, das beim ersten Start erzeugt wird. Ihr Browser fordert Sie einmalig auf, es zu akzeptieren. Für ein echtes Zertifikat setzen Sie einen Reverse Proxy davor (siehe unten).

Der erste Start erzeugt die Passwörter und die Schlüssel, legt die Datenbank an, wendet die Migrationen an und startet alle Dienste. Alles wird neben der Compose-Datei gespeichert:

| Ordner            | Inhalt                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `./data/postgres` | Die Datenbank.                                                                             |
| `./data/valkey`   | Die Warteschlangen der Hintergrundaufgaben.                                                |
| `./data/fichiers` | Hochgeladene und erzeugte Dokumente und Fotos.                                             |
| `./data/secrets`  | Erzeugte Passwörter und der Verschlüsselungsschlüssel. Bewahren Sie eine Kopie sicher auf. |
| `./data/certs`    | Das HTTPS-Zertifikat (`cert.pem`, `key.pem`).                                              |
| `./backups`       | Die täglichen Sicherungen.                                                                 |

Das sind gewöhnliche Ordner (Bind Mounts), keine Docker-Volumes: Sie können sie ansehen, kopieren und mit Ihren üblichen Werkzeugen sichern. Docker legt sie beim ersten Start mit dem richtigen Besitzer an. Sie führen weder `mkdir` noch `chown` aus.

## Die erste Garage anlegen

Eine neue Installation hat noch kein Konto. Legen Sie die erste Garage und ihr erstes Konto mit einem einzigen Befehl an: siehe [Ihre erste Garage einrichten](first-garage.md). Melden Sie sich danach unter der obigen Adresse an. Der Einrichtungsassistent, der durch die Einstellungen der Garage führt, startet nach dieser ersten Anmeldung.

## HTTPS mit Ihrem eigenen Reverse Proxy

dmsforall verwaltet weder Domainnamen noch Let's Encrypt. Um es auf einer Domain mit gültigem Zertifikat anzubieten, setzen Sie Ihren eigenen Reverse Proxy davor. Er muss an `https://127.0.0.1:8443` weiterleiten und das selbstsignierte Zertifikat des Upstreams akzeptieren (oder Sie legen Ihre eigenen `cert.pem` und `key.pem` in `./data/certs` ab und starten `web` neu).

Setzen Sie die öffentliche Adresse in `.env` und starten Sie dann neu:

```sh
DFA_PUBLIC_URL=https://dmsforall.example.ch
```

Caddy (er beschafft das Zertifikat selbstständig):

```text
dmsforall.example.ch {
  reverse_proxy https://127.0.0.1:8443 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
```

nginx:

```nginx
location / {
  proxy_pass https://127.0.0.1:8443;
  proxy_ssl_verify off;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 1g;
}
```

Cloudflare-Tunnel (`cloudflared`), in der Konfigurationsdatei:

```yaml
ingress:
  - hostname: dmsforall.example.ch
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Das Sitzungs-Cookie ist immer `Secure`: Nutzen Sie die Website nur über HTTPS. Mit einem Reverse Proxy davor vertraut die API zwei Proxy-Hops (Ihrem und dem Container `web`). Ohne `DFA_PUBLIC_URL` vertraut sie einem.

## Optionale Einstellungen

Nichts ist zwingend. Um eine Einstellung zu ändern, erstellen Sie neben `docker-compose.yml` eine Datei namens `.env`. Gehen Sie von `.env.example` aus, das jedem [Release](https://github.com/selfhostr/dmsforall/releases/latest) beiliegt, und entfernen Sie das `#` vor den Zeilen, die Sie brauchen.

| Variable                                                                                | Standard      | Wirkung                                                                       |
| --------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                           | `latest`      | Auszuführende Image-Version.                                                  |
| `DFA_PORT`                                                                              | `8443`        | Der veröffentlichte HTTPS-Port.                                               |
| `DFA_PUBLIC_URL`                                                                        | keiner        | Öffentliche Adresse hinter Ihrem Reverse Proxy. Wird in E-Mail-Links benutzt. |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | keiner, `587` | Ausgehende E-Mails. Der Versand wird aktiv, sobald der Host gesetzt ist.      |
| `DFA_BACKUP_TIME`                                                                       | `02:30`       | Uhrzeit der täglichen Sicherung (Serverzeit).                                 |
| `DFA_BACKUP_KEEP_DAYS`                                                                  | `14`          | Aufbewahrte Tage an Sicherungen.                                              |

Die übrigen Einstellungen finden Sie in der [Konfigurationsreferenz](../reference/configuration.md).

## Die Dienste

| Dienst     | Rolle                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `web`      | Die Web-Oberfläche in HTTPS. Der einzige veröffentlichte Port. Leitet `/api` an die API weiter.     |
| `api`      | Die API. Wendet beim Start die Datenbankmigrationen an. Nicht veröffentlicht.                       |
| `worker`   | Hintergrundaufgaben, aus demselben Image wie die API. Startet, sobald die API gesund ist.           |
| `postgres` | PostgreSQL 16. Nicht veröffentlicht.                                                                |
| `valkey`   | Valkey (Open Source, Redis-kompatibel). Nicht veröffentlicht.                                       |
| `backup`   | Die tägliche Sicherung in `./backups`. Siehe [Sichern und wiederherstellen](backup-and-restore.md). |

Das Profil `ocr` startet den Fahrzeugausweis-Scanner: `docker compose --profile ocr up -d`. Die Anwendung funktioniert auch ohne ihn, es fehlt nur die Abkürzung «Fahrzeugausweis scannen».

## Aus dem Quellcode bauen

Um die Images aus einem Klon des Repositorys zu bauen, statt sie zu laden:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Installation prüfen

```sh
docker compose ps
curl -k https://localhost:8443/api/v1/sante
```

Erwartetes Ergebnis: Alle Dienste sind `healthy` (`worker` und `backup` nach wenigen Sekunden), und der Gesundheitsendpunkt liefert ein JSON-Dokument. Ersetzen Sie `localhost:8443` durch Ihre Adresse.

:::caution
Die Daten in `./data/postgres` und die Passwörter in `./data/secrets` gehören zusammen. Wenn Sie eines davon ohne das andere löschen oder ersetzen, weigert sich die API zu starten und nennt Ihnen den Ordner, den Sie wiederherstellen müssen. Löschen Sie `./data/secrets` nie allein.
:::

:::caution
Lassen Sie `OPENAPI_EXPOSER_DOCS` ungesetzt oder auf `false` auf einem Server, der aus dem Internet erreichbar ist.
:::
