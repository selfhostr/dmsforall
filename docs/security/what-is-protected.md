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
- **Encryption at rest.** Docker named volumes are not encrypted by Docker. Encrypt the disk or partition under the Docker data directory.
- **Off-site backups.** The nightly backup is encrypted, but it is kept on the same server until you configure an off-site copy. A backup on the same disk does not protect against a lost server. See [Back up and restore](../get-started/backup-and-restore.md).
- **The PDF cache.** It is not backed up. It is generated again from the database.
- **The server itself.** The operating system, the Docker host, its users and its updates are your responsibility.
- **Access to the database.** Anyone with the PostgreSQL superuser password can read all data. Keep that password separate from the application passwords.
- **Client-side security.** A browser that is left unlocked gives access to the account that is signed in. Set session lengths that suit your staff. See the `SESSION_*` variables in the [configuration reference](../reference/configuration.md).
- **Rate limits behind a proxy.** The limits use the client IP address. If `TRUST_PROXY_HOPS` is wrong, all users may share one limit, or a client may forge its address.

## What you must do

1. Serve dmsforall over HTTPS only, with a valid certificate.
2. Replace all development passwords before the first start. Use a password manager.
3. Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the API.
4. Keep `OPENAPI_EXPOSER_DOCS=false` and `COOKIE_SECURE=true` in production.
5. Close every port except 80 and 443 at the firewall.
6. Keep the server, Docker and the images up to date. See [Upgrading](../operations/upgrading.md).
7. Test a restore of your backups regularly.
8. Review the roles of your staff at least once a year, and deactivate the accounts of people who leave.

To report a vulnerability, follow [SECURITY.md](https://github.com/selfhostr/dmsforall/blob/main/SECURITY.md). Do not open a public issue.
