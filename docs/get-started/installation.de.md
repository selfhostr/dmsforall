---
title: dmsforall auf einem Server installieren
description: Einstellungen, HTTPS, die Dienste des Stacks, optionale Profile und Prüfungen einer dmsforall-Installation.
---

Diese Seite behandelt eine Installation auf einem Server. Die [Schnellstart](quick-start.md)-Anleitung gibt die Kurzfassung für `localhost`.

Am Ende dieser Seite läuft der Stack auf Ihrem Server, und Sie haben geprüft, dass er antwortet.

## Voraussetzungen

- Docker Engine und Docker Compose v2.
- Für HTTPS auf einer Domain: ein DNS-Name, der auf den Server zeigt, und die Ports 80 und 443, die aus dem Internet erreichbar sind.
- Speicherplatz für die PostgreSQL-Daten, die Sicherungen und die hochgeladenen Dokumente.

## Einstellungen

Erstellen Sie neben `docker-compose.yml` eine Datei namens `.env`. Gehen Sie von `.env.example` aus, das jedem [Release](https://github.com/selfhostr/dmsforall/releases/latest) beiliegt, und entfernen Sie das `#` vor den Zeilen, die Sie brauchen. Nichts ist zwingend: Jede Einstellung hat einen Standardwert. Die wichtigsten sind:

| Variable               | Standard                | Wirkung                                                                                                 |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `DFA_SITE_ADDRESS`     | `http://localhost`      | Adresse der Website. Setzen Sie einen Domainnamen, um HTTPS zu erhalten.                                |
| `DFA_PUBLIC_URL`       | `http://localhost:8080` | Öffentliche Adresse, die die Benutzer im Browser eingeben. Muss mit der Website-Adresse übereinstimmen. |
| `DFA_HTTP_PORT`        | `8080`                  | Host-Port für HTTP.                                                                                     |
| `DFA_HTTPS_PORT`       | `8443`                  | Host-Port für HTTPS.                                                                                    |
| `DFA_VERSION`          | `latest`                | Auszuführende Image-Version.                                                                            |
| `DFA_TRUST_PROXY_HOPS` | `1`                     | Anzahl der Reverse Proxies vor der API.                                                                 |

Der ausgehende E-Mail-Versand wird mit `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD` und `DFA_SMTP_FROM` eingestellt. Der Versand wird automatisch aktiviert, sobald der Host gesetzt ist. Die übrigen Einstellungen finden Sie in der [Konfigurationsreferenz](../reference/configuration.md).

Sie geben nie ein Geheimnis selbst ein. Der Dienst `init-secrets` erzeugt beim ersten Start die Datenbank-Passwörter und den Schlüssel, der die gespeicherten Passwörter verschlüsselt, und bewahrt sie im Volume `dfa_secrets` auf. Die Rollen und Verbindungszeichenketten der Datenbank leiten sich daraus ab. Bewahren Sie eine Kopie des Inhalts dieses Volumes auf: siehe [Sichern und wiederherstellen](backup-and-restore.md).

## HTTPS

Wenn `DFA_SITE_ADDRESS` ein Domainname ist, beschafft und erneuert Caddy selbstständig ein Let's-Encrypt-Zertifikat. Die Ports 80 und 443 müssen den Server erreichen.

:::caution
HTTPS mit einer echten Domain wurde noch nicht durchgehend getestet. Prüfen Sie das Zertifikat nach dem ersten Start, und lesen Sie die Logs von Caddy, wenn es fehlt.
:::

## Die Dienste

| Dienst         | Rolle                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| `proxy`        | Caddy. Veröffentlicht die HTTP- und HTTPS-Ports und leitet Anfragen weiter.  |
| `web`          | Die Web-Oberfläche.                                                          |
| `api`          | Die API. Nicht veröffentlicht.                                               |
| `worker`       | Hintergrundaufgaben, aus demselben Image wie die API.                        |
| `migrate`      | Wendet die Datenbankmigrationen an, bevor die API startet.                   |
| `postgres`     | PostgreSQL 16. Nicht veröffentlicht.                                         |
| `redis`        | Valkey. Nicht veröffentlicht.                                                |
| `init-secrets` | Erzeugt die Datenbank-Passwörter und den Verschlüsselungsschlüssel einmalig. |

PostgreSQL und Valkey werden nie auf einem Host-Port veröffentlicht.

## Optionale Profile

- `--profile ocr`: startet das Image `ghcr.io/selfhostr/dmsforall-ocr`, das Fahrzeugausweise liest. Dieses Profil wurde noch nicht gestartet.
- `--profile backup`: startet die nächtlichen verschlüsselten Sicherungen aus dem Image `ghcr.io/selfhostr/dmsforall-backup`. Dafür braucht es `AGE_CLE_PUBLIQUE` in `.env`. Siehe [Sichern und wiederherstellen](backup-and-restore.md).

```sh
docker compose --profile backup up -d
```

## Aus dem Quellcode bauen

Um die Images aus einem Klon des Repositorys zu bauen, statt sie zu laden:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Die erste Garage anlegen

Sobald der Stack läuft, legen Sie das erste Garagenkonto an. Den Befehl und seine Optionen finden Sie in [Ihre erste Garage einrichten](first-garage.md).

## Installation prüfen

```sh
docker compose ps
curl -s http://localhost:8080/api/v1/sante
```

Ersetzen Sie `localhost:8080` auf einem Server durch Ihre Domain. Erwartetes Ergebnis: `postgres` und `redis` sind `healthy`, `migrate` ist ohne Fehler beendet, `api` und `worker` laufen, und der Gesundheitsendpunkt liefert ein JSON-Dokument.

:::caution
Lassen Sie `OPENAPI_EXPOSER_DOCS` ungesetzt oder auf `false` auf einem Server, der aus dem Internet erreichbar ist.
:::
