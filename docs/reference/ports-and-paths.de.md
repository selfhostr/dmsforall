---
title: Ports und Pfade
description: Netzwerkports, Speicherpfade und Docker-Volumes, die dmsforall im Standard-Stack und in der Entwicklung verwendet.
---

## Netzwerkports

### Standard-Stack (`docker-compose.yml`)

| Dienst                 | Host-Port                 | Hinweise                                                                                                               |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `proxy` (Caddy) HTTP   | `8080` (`DFA_HTTP_PORT`)  | Wird auf den Container-Port 80 abgebildet.                                                                             |
| `proxy` (Caddy) HTTPS  | `8443` (`DFA_HTTPS_PORT`) | Wird auf den Container-Port 443 abgebildet. Mit einer Domain in `DFA_SITE_ADDRESS` verwenden Sie die Ports 80 und 443. |
| `web`, `api`, `worker` | keiner                    | Nur über den Proxy erreichbar.                                                                                         |
| `postgres`, `redis`    | keiner                    | Werden nie veröffentlicht.                                                                                             |
| `ocr-permis`           | keiner                    | Profil `ocr`, von der API im Docker-Netzwerk erreichbar.                                                               |

Nur der Proxy veröffentlicht einen Port. Halten Sie die übrigen Ports an der Firewall geschlossen.

### Entwicklung (`docker/compose.dev.yml`)

| Dienst         | Port | Hinweise                                               |
| -------------- | ---- | ------------------------------------------------------ |
| API            | 3000 | `PORT` in `.env`. Läuft auf dem Host mit `pnpm dev`.   |
| Web-Oberfläche | 5173 | Vite-Entwicklungsserver.                               |
| PostgreSQL     | 5432 | Veröffentlicht, damit Werkzeuge sich verbinden können. |
| Valkey         | 6379 | Veröffentlicht, damit Werkzeuge sich verbinden können. |

## Speicherpfade

| Pfad oder Volume                    | Inhalt                                                       | Von der nächtlichen Sicherung erfasst                    |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `dmsforall_dfa_postgres_data`       | PostgreSQL-Daten.                                            | Ja, über den Dump.                                       |
| `dmsforall_dfa_postgres_backups`    | Verschlüsselte nächtliche Sicherungen (Profil `backup`).     | Nur lokale Kopie.                                        |
| `dmsforall_dfa_api_uploads`         | Hochgeladene und erzeugte PDF-Dokumente.                     | Ja, im Dateiarchiv.                                      |
| `dmsforall_dfa_exports_resiliation` | Exporte, die beim Austritt einer Garage erstellt werden.     | Ja, im Dateiarchiv.                                      |
| `dmsforall_dfa_photos_or`           | Fotos zu Reparaturaufträgen und Vorschaubilder.              | Ja, im Dateiarchiv.                                      |
| `dmsforall_dfa_reprise`             | Archive, die für eine Datenübernahme hochgeladen wurden.     | Ja, im Dateiarchiv.                                      |
| `dmsforall_dfa_secrets`             | Erzeugte Datenbank-Passwörter und Verschlüsselungsschlüssel. | Nein. Bewahren Sie eine Kopie an einem sicheren Ort auf. |
| `dmsforall_dfa_redis_data`          | Valkey-Daten.                                                | Nein.                                                    |
| `dmsforall_dfa_caddy_data`          | TLS-Zertifikate, die Caddy beschafft hat.                    | Nein.                                                    |

Das Dateiarchiv (`dfa_<timestamp>.uploads.tar.gz.age`) umfasst alles, was im Dienst `backup` unter `/uploads` eingehängt ist. Siehe [Sichern und wiederherstellen](../get-started/backup-and-restore.md).

In der Entwicklung werden PDF-Dateien unter `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf` geschrieben.

:::caution
Docker-Named-Volumes werden von Docker nicht verschlüsselt. Für ruhende Daten verwenden Sie eine verschlüsselte Festplatte oder Partition unter dem Datenverzeichnis von Docker. Siehe [Was geschützt ist](../security/what-is-protected.md).
:::
