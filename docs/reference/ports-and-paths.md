---
title: Ports and paths
description: Network ports and storage paths used by dmsforall in the default stack and in development.
---

## Network ports

### Default stack (`docker-compose.yml`)

| Service                        | Host port           | Notes                                                            |
| ------------------------------ | ------------------- | ---------------------------------------------------------------- |
| `web`                          | `8443` (`DFA_PORT`) | HTTPS only, maps to container port 8443. Relays `/api` to `api`. |
| `api`, `worker`                | none                | Reached through `web` only.                                      |
| `postgres`, `valkey`, `backup` | none                | Never published.                                                 |
| `ocr-permis`                   | none                | Profile `ocr`, reached from the API inside the Docker network.   |

Only `web` publishes a port, and there is no HTTP port. Keep other ports closed at the firewall.

### Development (`docker/compose.dev.yml`)

| Service       | Port | Notes                                               |
| ------------- | ---- | --------------------------------------------------- |
| API           | 3000 | `PORT` in `.env`. Runs on the host with `pnpm dev`. |
| Web interface | 5173 | Vite development server.                            |
| PostgreSQL    | 5432 | Published so that tools can connect.                |
| Valkey        | 6379 | Published so that tools can connect.                |

## Storage paths

The default stack uses plain folders next to `docker-compose.yml` (bind mounts), no Docker volume.

| Folder            | Content                                                  | Covered by the daily backup     |
| ----------------- | -------------------------------------------------------- | ------------------------------- |
| `./data/postgres` | PostgreSQL data.                                         | Yes, through the dump.          |
| `./data/fichiers` | Uploaded and generated documents, photos, exports.       | Yes, in the files archive.      |
| `./data/secrets`  | Generated database passwords and encryption key.         | No. Keep a copy somewhere safe. |
| `./data/valkey`   | Valkey data (job queues).                                | No.                             |
| `./data/certs`    | HTTPS certificate: `cert.pem` and `key.pem`.             | No. Regenerated if missing.     |
| `./backups`       | The daily backups (`dfa-*.sql.gz`, `fichiers-*.tar.gz`). | Local copy only.                |

The files archive covers everything under `./data/fichiers`. See [back up and restore](../get-started/backup-and-restore.md).

In development, PDF files are written to `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
The folders are not encrypted by Docker. For data at rest, use an encrypted disk or partition under the folder that holds `docker-compose.yml`. See [what is protected](../security/what-is-protected.md).
:::
