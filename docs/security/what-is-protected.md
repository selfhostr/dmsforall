---
title: What is protected and what is not
description: The security controls that dmsforall provides, the ones it does not provide, and what the operator must do.
---

This page lists the protections that dmsforall provides in the code, the gaps that remain in this version, and what you must run yourself. Read it before you put real data on a server.

## What dmsforall protects

**Separation between garages.** Each garage is a tenant. Every tenant table has a `tenant_id` column and PostgreSQL row-level security. The API also scopes each query to the tenant of the signed-in user. The tenant comes from the session, never from a request parameter. The API connects with a role that is subject to row-level security, and migrations use a different role.

**Passwords and sign-in.** Passwords are hashed with Argon2id. Sign-in attempts are limited per IP address and per account. After repeated failed passwords, the account is locked for a while. Password reset is done with a token sent by e-mail.

**Sessions.** The session cookie is HTTP-only. It is marked `Secure` by default, and the production configuration refuses to start if that is turned off. The API checks the `Origin` header of requests that change data.

**Rights.** Every route checks the rights of the role against one rights matrix. See [roles and rights](../reference/roles-and-rights.md).

**Money.** Amounts are integers in centimes. An issued invoice is locked, and a correction is a credit note. The audit trail records who changed a sensitive entity, when, and the values before and after.

**Configuration.** The API validates every variable at start-up and refuses to start with an invalid value. In production, it refuses the development database passwords.

**API documentation.** The OpenAPI documentation is off by default. It is published only when `OPENAPI_EXPOSER_DOCS=true`.

**Data location.** Everything runs on your server. dmsforall does not send data to a third-party service. The optional error reporting goes only to the Sentry-compatible server that you set in `SENTRY_DSN`.

## What dmsforall does not protect

- **Second factor for garage accounts.** Two-factor authentication (TOTP) is not available for garage staff accounts in this version. The operator console, which is not used by garages, requires a second factor. Use long, unique passwords for all accounts.
- **Encryption at rest.** The `./data` and `./backups` folders are not encrypted by Docker. Encrypt the disk or partition that holds them.
- **Off-site backups.** The daily backup is written to `./backups` on the same server (encrypted only if you set `DFA_BACKUP_AGE_PUBLIC_KEY`). Copy it off the server yourself. A backup on the same disk does not protect against a lost server. See [Back up and restore](../get-started/backup-and-restore.md).
- **The PDF cache.** It is not backed up. It is generated again from the database.
- **The server itself.** The operating system, the Docker host, its users and its updates are your responsibility.
- **Access to the database.** Anyone with the PostgreSQL superuser password can read all data. That password and the application passwords are in `./data/secrets`: keep that folder readable by root only. The database is not published, and only the `web` container exposes a port.
- **Client-side security.** A browser that is left unlocked gives access to the account that is signed in. Set session lengths that suit your staff. See the `SESSION_*` variables in the [configuration reference](../reference/configuration.md).
- **Rate limits behind a proxy.** The limits use the client IP address. If `TRUST_PROXY_HOPS` is wrong, all users may share one limit, or a client may forge its address.

## What you must do

1. Serve dmsforall over HTTPS with a valid certificate: put your own reverse proxy in front and set `DFA_PUBLIC_URL`. The published port is HTTPS only, with a self-signed certificate by default.
2. Keep a copy of `./data/secrets` somewhere safe.
3. If you add a reverse proxy, check that it sends `X-Forwarded-For`, and set `TRUST_PROXY_HOPS` if you chain more than one.
4. Keep `OPENAPI_EXPOSER_DOCS=false` and `COOKIE_SECURE=true` in production.
5. Open only the HTTPS port at the firewall (the one of your reverse proxy, and `8443` only if it must be reached directly).
6. Keep the server, Docker and the images up to date. See [Upgrading](../operations/upgrading.md).
7. Test a restore of your backups regularly.
8. Review the roles of your staff at least once a year, and deactivate the accounts of people who leave.

To report a vulnerability, follow [SECURITY.md](https://github.com/selfhostr/dmsforall/blob/main/SECURITY.md). Do not open a public issue.
