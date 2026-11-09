---
title: Install dmsforall on a server
description: Settings, HTTPS, the services of the stack, optional profiles, and checks for an installation of dmsforall.
---

This page covers an installation on a server. The [Quick start](quick-start.md) gives the short version for `localhost`.

At the end of this page, the stack runs on your server, and you have checked that it answers.

## Requirements

- Docker Engine and Docker Compose v2.
- For HTTPS on a domain: a DNS name that points to the server, and ports 80 and 443 open to the Internet.
- Disk space for the PostgreSQL data, the backups and the uploaded documents.

## Settings

Next to `docker-compose.yml`, create a file named `.env`. Start from `.env.example`, which is attached to each [release](https://github.com/selfhostr/dmsforall/releases/latest), and remove the `#` in front of the lines you need. Nothing is required: every setting has a default. The most common ones are:

| Variable               | Default                 | Effect                                                                      |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `DFA_SITE_ADDRESS`     | `http://localhost`      | Address of the site. Set a domain name to get HTTPS.                        |
| `DFA_PUBLIC_URL`       | `http://localhost:8080` | Public address that users type in the browser. Must match the site address. |
| `DFA_HTTP_PORT`        | `8080`                  | Host port for HTTP.                                                         |
| `DFA_HTTPS_PORT`       | `8443`                  | Host port for HTTPS.                                                        |
| `DFA_VERSION`          | `latest`                | Image version to run.                                                       |
| `DFA_TRUST_PROXY_HOPS` | `1`                     | Number of reverse proxies in front of the API.                              |

Outgoing e-mail is set with `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD` and `DFA_SMTP_FROM`. Sending turns on by itself once the host is set. The other settings are in the [configuration reference](../reference/configuration.md).

You never type a secret. The `init-secrets` service generates the database passwords and the key that encrypts stored passwords on the first start, and keeps them in the `dfa_secrets` volume. The roles and connection strings of the database are derived from them. Keep a copy of that volume's content: see [Back up and restore](backup-and-restore.md).

## HTTPS

When `DFA_SITE_ADDRESS` is a domain name, Caddy obtains and renews a Let's Encrypt certificate by itself. Ports 80 and 443 must reach the server.

:::caution
HTTPS with a real domain has not been tested end to end yet. Check the certificate after the first start, and read the Caddy logs if it is missing.
:::

## The services

| Service        | Role                                                           |
| -------------- | -------------------------------------------------------------- |
| `proxy`        | Caddy. Publishes the HTTP and HTTPS ports and routes requests. |
| `web`          | The web interface.                                             |
| `api`          | The API. Not published.                                        |
| `worker`       | Background jobs, from the same image as the API.               |
| `migrate`      | Applies the database migrations before the API starts.         |
| `postgres`     | PostgreSQL 16. Not published.                                  |
| `redis`        | Valkey. Not published.                                         |
| `init-secrets` | Generates the database passwords and the encryption key once.  |

PostgreSQL and Valkey are never published on a host port.

## Optional profiles

- `--profile ocr`: starts the image `ghcr.io/selfhostr/dmsforall-ocr`, which reads vehicle registration documents. This profile has not been started yet.
- `--profile backup`: starts the nightly encrypted backups, from the image `ghcr.io/selfhostr/dmsforall-backup`. It needs `AGE_CLE_PUBLIQUE` in `.env`. See [Back up and restore](backup-and-restore.md).

```sh
docker compose --profile backup up -d
```

## Build from source

To build the images from a clone of the repository instead of pulling them:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Create the first garage

Once the stack is up, create the first garage account. See [Set up your first garage](first-garage.md) for the command and its options.

## Check the installation

```sh
docker compose ps
curl -s http://localhost:8080/api/v1/sante
```

Replace `localhost:8080` with your domain for a server. Expected result: `postgres` and `redis` are healthy, `migrate` has exited without error, `api` and `worker` are running, and the health endpoint returns a JSON document.

:::caution
Keep `OPENAPI_EXPOSER_DOCS` unset or `false` on a server reachable from the Internet.
:::
