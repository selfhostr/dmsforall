---
title: Install dmsforall on a server
description: Install dmsforall with one Compose file, put your own reverse proxy in front for HTTPS on a domain, and check the installation.
---

This page covers an installation on a server. The [Quick start](quick-start.md) gives the short version.

At the end of this page, the stack runs on your server, behind your HTTPS reverse proxy if you have one, and you have checked that it answers.

## Requirements

- Docker Engine and Docker Compose 2.24 or later.
- Disk space for the database, the uploaded documents and the backups.
- For a domain name with a real certificate: a reverse proxy of your own (Caddy, nginx, Traefik, a Cloudflare tunnel).

## Install

Create an empty folder, download the Compose file into it, and start the stack. That file is all you need. You create no other file and no sub-folder.

```sh
mkdir dmsforall && cd dmsforall
curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
docker compose up -d
```

Open `https://<server address>:8443`. dmsforall publishes one port, in HTTPS only, with a self-signed certificate generated on the first start. Your browser asks you to accept it once. For a real certificate, put a reverse proxy in front (below).

The first start generates the passwords and the keys, creates the database, applies the migrations and starts every service. Everything is stored next to the Compose file:

| Folder            | Content                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `./data/postgres` | The database.                                                           |
| `./data/valkey`   | The queues of background jobs.                                          |
| `./data/fichiers` | Uploaded and generated documents and photos.                            |
| `./data/secrets`  | Generated passwords and the encryption key. Keep a copy somewhere safe. |
| `./data/certs`    | The HTTPS certificate (`cert.pem`, `key.pem`).                          |
| `./backups`       | The daily backups.                                                      |

These are plain folders (bind mounts), not Docker volumes: you can see them, copy them and back them up with your usual tools. Docker creates them with the right owner on the first start. You do not run `mkdir` or `chown`.

## Create the first garage

A new installation has no account yet. Create the first garage and its first account with one command: see [Set up your first garage](first-garage.md). Then sign in at the address above. The setup assistant that guides the garage settings starts after that first sign-in.

## HTTPS with your own reverse proxy

dmsforall does not manage domain names or Let's Encrypt. To serve it on a domain with a valid certificate, put your own reverse proxy in front. It must forward to `https://127.0.0.1:8443` and accept the self-signed certificate of the upstream (or you put your own `cert.pem` and `key.pem` in `./data/certs` and restart `web`).

Set the public address in `.env`, then restart:

```sh
DFA_PUBLIC_URL=https://dmsforall.example.ch
```

Caddy (it gets the certificate by itself):

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

Cloudflare tunnel (`cloudflared`), in the configuration file:

```yaml
ingress:
  - hostname: dmsforall.example.ch
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

The session cookie is always `Secure`: use the site only over HTTPS. With one reverse proxy in front, the API trusts two proxy hops (yours and the `web` container). Without `DFA_PUBLIC_URL`, it trusts one.

## Optional settings

Nothing is required. To change a setting, create a file named `.env` next to `docker-compose.yml`, starting from `.env.example` (attached to each [release](https://github.com/selfhostr/dmsforall/releases/latest)), and remove the `#` in front of the lines you need.

| Variable                                                                                | Default     | Effect                                                          |
| --------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| `DFA_VERSION`                                                                           | `latest`    | Image version to run.                                           |
| `DFA_PORT`                                                                              | `8443`      | The published HTTPS port.                                       |
| `DFA_PUBLIC_URL`                                                                        | none        | Public address behind your reverse proxy. Used in e-mail links. |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | none, `587` | Outgoing e-mail. Sending turns on once the host is set.         |
| `DFA_BACKUP_TIME`                                                                       | `02:30`     | Hour of the daily backup (server time).                         |
| `DFA_BACKUP_KEEP_DAYS`                                                                  | `14`        | Days of backups kept.                                           |

The other settings are in the [configuration reference](../reference/configuration.md).

## The services

| Service    | Role                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| `web`      | The web interface in HTTPS. The only published port. Relays `/api` to the API.      |
| `api`      | The API. Applies the database migrations when it starts. Not published.             |
| `worker`   | Background jobs, from the same image as the API. Starts after the API is healthy.   |
| `postgres` | PostgreSQL 16. Not published.                                                       |
| `valkey`   | Valkey (open source, Redis compatible). Not published.                              |
| `backup`   | The daily backup, in `./backups`. See [Back up and restore](backup-and-restore.md). |

The `ocr` profile starts the registration-document scanner: `docker compose --profile ocr up -d`. The application works without it, only the "scan the registration document" shortcut is missing.

## Build from source

To build the images from a clone of the repository instead of pulling them:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Check the installation

```sh
docker compose ps
curl -k https://localhost:8443/api/v1/sante
```

Expected result: every service is healthy (the `worker` and `backup` after a few seconds), and the health endpoint returns a JSON document. Replace `localhost:8443` with your address.

:::caution
The data in `./data/postgres` and the passwords in `./data/secrets` go together. If you delete or replace one of them without the other, the API refuses to start and tells you which folder to restore. Never delete `./data/secrets` alone.
:::

:::caution
Keep `OPENAPI_EXPOSER_DOCS` unset or `false` on a server reachable from the Internet.
:::
