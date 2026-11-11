---
title: Ports und Pfade
description: Netzwerkports und Speicherpfade, die dmsforall im Standard-Stack und in der Entwicklung verwendet.
---

## Netzwerkports

### Standard-Stack (`docker-compose.yml`)

| Dienst                         | Host-Port           | Hinweise                                                                               |
| ------------------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| `web`                          | `8443` (`DFA_PORT`) | Nur HTTPS, wird auf den Container-Port 8443 abgebildet. Leitet `/api` an `api` weiter. |
| `api`, `worker`                | keiner              | Nur über `web` erreichbar.                                                             |
| `postgres`, `valkey`, `backup` | keiner              | Werden nie veröffentlicht.                                                             |
| `ocr-permis`                   | keiner              | Profil `ocr`, von der API im Docker-Netzwerk erreichbar.                               |

Nur `web` veröffentlicht einen Port, und es gibt keinen HTTP-Port. Halten Sie die übrigen Ports an der Firewall geschlossen.

### Entwicklung (`docker/compose.dev.yml`)

| Dienst         | Port | Hinweise                                               |
| -------------- | ---- | ------------------------------------------------------ |
| API            | 3000 | `PORT` in `.env`. Läuft auf dem Host mit `pnpm dev`.   |
| Web-Oberfläche | 5173 | Vite-Entwicklungsserver.                               |
| PostgreSQL     | 5432 | Veröffentlicht, damit Werkzeuge sich verbinden können. |
| Valkey         | 6379 | Veröffentlicht, damit Werkzeuge sich verbinden können. |

## Speicherpfade

Der Standard-Stack verwendet gewöhnliche Ordner neben `docker-compose.yml` (Bind Mounts), kein Docker-Volume.

| Ordner            | Inhalt                                                           | Von der täglichen Sicherung erfasst       |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `./data/postgres` | PostgreSQL-Daten.                                                | Ja, über den Dump.                        |
| `./data/fichiers` | Hochgeladene und erzeugte Dokumente, Fotos, Exporte.             | Ja, im Dateiarchiv.                       |
| `./data/secrets`  | Erzeugte Datenbank-Passwörter und Verschlüsselungsschlüssel.     | Nein. Bewahren Sie eine Kopie sicher auf. |
| `./data/valkey`   | Valkey-Daten (Warteschlangen).                                   | Nein.                                     |
| `./data/certs`    | HTTPS-Zertifikat: `cert.pem` und `key.pem`.                      | Nein. Wird neu erzeugt, wenn es fehlt.    |
| `./backups`       | Die täglichen Sicherungen (`dfa-*.sql.gz`, `fichiers-*.tar.gz`). | Nur lokale Kopie.                         |

Das Dateiarchiv umfasst alles unter `./data/fichiers`. Siehe [Sichern und wiederherstellen](../get-started/backup-and-restore.md).

In der Entwicklung werden PDF-Dateien unter `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf` geschrieben.

:::caution
Die Ordner werden von Docker nicht verschlüsselt. Für ruhende Daten verwenden Sie eine verschlüsselte Festplatte oder Partition unter dem Ordner, der `docker-compose.yml` enthält. Siehe [Was geschützt ist](../security/what-is-protected.md).
:::
