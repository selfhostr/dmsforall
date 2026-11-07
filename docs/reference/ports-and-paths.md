---
title: Ports and paths
description: Network ports, storage paths and Docker volumes used by dmsforall in the default stack and in development.
---

## Network ports

### Default stack (`docker-compose.yml`)

| Service                | Host port                 | Notes                                                                                |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `proxy` (Caddy) HTTP   | `8080` (`DFA_HTTP_PORT`)  | Maps to container port 80.                                                           |
| `proxy` (Caddy) HTTPS  | `8443` (`DFA_HTTPS_PORT`) | Maps to container port 443. Use port 80 and 443 with a domain in `DFA_SITE_ADDRESS`. |
| `web`, `api`, `worker` | none                      | Reached through the proxy only.                                                      |
| `postgres`, `redis`    | none                      | Never published.                                                                     |
| `ocr-permis`           | none                      | Profile `ocr`, reached from the API inside the Docker network.                       |

Only the proxy publishes a port. Keep other ports closed at the firewall.

### Development (`docker-compose.dev.yml`)

| Service       | Port | Notes                                               |
| ------------- | ---- | --------------------------------------------------- |
| API           | 3000 | `PORT` in `.env`. Runs on the host with `pnpm dev`. |
| Web interface | 5173 | Vite development server.                            |
| PostgreSQL    | 5432 | Published so that tools can connect.                |
| Redis         | 6379 | Published so that tools can connect.                |

## Storage paths

| Path or volume                      | Content                                        | Backed up by the nightly backup |
| ----------------------------------- | ---------------------------------------------- | ------------------------------- |
| `dmsforall_dfa_postgres_data`       | PostgreSQL data.                               | Yes, through the dump.          |
| `dmsforall_dfa_postgres_backups`    | Encrypted nightly backups (profile `backup`).  | Local copy only.                |
| `dmsforall_dfa_api_uploads`         | Uploaded and generated PDF documents.          | No.                             |
| `dmsforall_dfa_exports_resiliation` | Exports made when a garage leaves the service. | No.                             |
| `dmsforall_dfa_photos_or`           | Repair order photos and thumbnails.            | No.                             |
| `dmsforall_dfa_reprise`             | Archives uploaded for a data takeover.         | No.                             |
| `dmsforall_dfa_secrets`             | Generated database passwords.                  | No. Keep a copy somewhere safe. |
| `dmsforall_dfa_redis_data`          | Redis data.                                    | No.                             |
| `dmsforall_dfa_caddy_data`          | TLS certificates obtained by Caddy.            | No.                             |

In development, PDF files are written to `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
Docker named volumes are not encrypted by Docker. For data at rest, use an encrypted disk or partition under the Docker data directory. See [what is protected](../security/what-is-protected.md).
:::
