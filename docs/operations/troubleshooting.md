---
title: Troubleshooting
description: Diagnose the most common problems with a dmsforall installation, from start-up errors to e-mail, OCR and import failures.
---

Start with the logs of the service that fails:

```sh
docker compose logs api --tail 100
docker compose ps
```

## The API does not start

**Message: `Invalid configuration`.** The log lists every faulty variable, with the reason. Fix each one in `.env`, then run `docker compose up -d` again. With the standard Compose file you rarely meet this error, because the database connection and the keys are set for you.

**The message says `COOKIE_SECURE must be true in production`.** Remove the `COOKIE_SECURE=false` line from `.env`. The session cookie must be sent over HTTPS.

**The message says that a development password is used.** The database URL contains `dfa_app_dev` or `dfa_migrator_dev`. You set `DATABASE_URL` yourself with the development passwords. Remove `DATABASE_URL` and `DATABASE_URL_MIGRATION` from `.env`: the stack builds them from generated passwords.

**The message names `DATABASE_POOL_MIN`.** A value above `DATABASE_POOL_MAX` is refused. Lower the minimum or raise the maximum.

## Sign-in fails

**The web access is refused with `AUTH_ORIGINE_REFUSEE`.** The address in your browser does not match `DFA_PUBLIC_URL` (default `http://localhost:8080`). Open the site at that address, or change `DFA_PUBLIC_URL` and restart the stack.

**The password is refused, and the account is locked.** Wait until the lock expires. Repeated failures lock the account for a while. The limit is set by `SEUIL_VERROUILLAGE_COMPTE`.

**Sign-in returns `429`.** Too many attempts from one address, or too many attempts on one account. Wait for the window to end. If all users are blocked at once, `TRUST_PROXY_HOPS` is probably wrong, and all users share one address.

**The page loads, but you stay signed out.** Check that `WEB_URL_PUBLIQUE` and `API_URL_PUBLIQUE` use HTTPS and match the addresses in your browser. Check `COOKIE_DOMAINE`, if you set it.

## The database is busy

**Message: `timeout exceeded when trying to connect`.** All connections of the pool are in use. Look for a slow query in the logs, or raise `DATABASE_POOL_MAX` if the server has room. Check the PostgreSQL `max_connections` limit too.

## E-mails do not arrive

Each garage can set its own sending server in **Settings > Sending e-mails**; it is used first, and the screen has a test button. Without it, messages are sent for real only when `NODE_ENV=production`, `COURRIEL_ENVOI_REEL=true`, and the `SMTP_*` variables are set. Otherwise the messages are captured and not delivered. Check these variables first, then the logs of the `api` service for the SMTP error.

## The vehicle OCR does not read the document

The OCR service must be running and reachable from the API at `OCR_SERVICE_URL`. If the service is slow, raise `OCR_SERVICE_TIMEOUT_MS`. An error that says the service is unavailable means the request was not processed, so try again.

## The data import stops

**The import stops with an error that the Access tools are unavailable.** An Access archive needs the `mdbtools` programs. The API container includes them. If you run the API outside the container, install `mdbtools` on the server.

**The import reports skipped records.** Read the reason given for each skipped record in the plan or the report.

## The page is blank after an upgrade

Check that the web container is running, and that its version matches the API version. Clear the cache of the browser, then reload. Check the logs of the `web` service.

## The migration failed

The API does not start on the new version, and the previous version keeps running. Read the logs of the `migrate` service, fix the cause in a new release, and run the upgrade again. Do not edit a migration file that has already been applied.

## Where to get more help

Open an issue on the [GitHub repository](https://github.com/selfhostr/dmsforall/issues) with the version, the relevant log lines, and the steps to reproduce. Remove any personal data and any secret before you paste a log.
