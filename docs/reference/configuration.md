---
title: Configuration reference
description: Every environment variable read by dmsforall, with its default value and its effect.
---

dmsforall reads its configuration from environment variables. The API validates them at start-up with zod and refuses to start if one is invalid. The error message lists every faulty variable.

In development, the variables are read from the `.env` file at the root of the repository. In the default stack, the API reads its variables from the Compose file, which takes its values from `.env`. Use `.env.example` as the list of settings.

Booleans take the values `true` or `false`. Durations are in minutes, seconds or milliseconds, as written in each name.

## Core

| Variable               | Default       | Effect                                                                                                 |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`             | `development` | `development`, `test` or `production`. Production enables stricter checks and the real e-mail sending. |
| `MODE_PROCESSUS`       | `combine`     | `api` serves HTTP only. `worker` runs the background jobs only. `combine` does both.                   |
| `PORT`                 | `3000`        | Port the API listens on, from 1 to 65535.                                                              |
| `API_URL_PUBLIQUE`     | required      | Public URL of the API, for example `https://api.garage.example.org`.                                   |
| `WEB_URL_PUBLIQUE`     | required      | Public URL of the web interface.                                                                       |
| `LOG_NIVEAU`           | `info`        | Log level: `fatal`, `error`, `warn`, `info`, `debug` or `trace`.                                       |
| `OPENAPI_EXPOSER_DOCS` | `false`       | Publish the API documentation at `/api/docs`. Keep it `false` in production.                           |

## Database

| Variable                        | Default                     | Effect                                                                                                                                     |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | required                    | PostgreSQL URL for the role `dfa_app`. This is the role the API uses, and it is subject to row-level security. Must start with `postgres`. |
| `DATABASE_URL_MIGRATION`        | required                    | PostgreSQL URL for the role `dfa_migrator`, used only to apply migrations. Must differ from `DATABASE_URL`.                                |
| `DATABASE_POOL_MAX`             | `10`                        | Maximum number of connections in the pool, from 1 to 50.                                                                                   |
| `DATABASE_POOL_MIN`             | `min(2, DATABASE_POOL_MAX)` | Connections kept open even when idle. Cannot exceed `DATABASE_POOL_MAX`.                                                                   |
| `DATABASE_TIMEOUT_REQUETE_MS`   | `10000`                     | Maximum time for one query, in milliseconds.                                                                                               |
| `DATABASE_TIMEOUT_CONNEXION_MS` | `5000`                      | Maximum time to open a connection, in milliseconds.                                                                                        |
| `DATABASE_TIMEOUT_IDLE_MS`      | `30000`                     | Time before an idle connection above the minimum is closed, in milliseconds.                                                               |

## Valkey

| Variable    | Default  | Effect                                                                                 |
| ----------- | -------- | -------------------------------------------------------------------------------------- |
| `REDIS_URL` | required | Valkey URL (Redis protocol, so it starts with `redis`). Used for queues, real-time events and rate limits. |

## Sessions and sign-in

| Variable                            | Default       | Effect                                                                                                |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `SESSION_COOKIE_NOM`                | `dfa_session` | Name of the session cookie. Letters, digits, `_` and `-` only.                                        |
| `SESSION_DUREE_MINUTES`             | `480`         | Maximum session length, from 5 to 43200 minutes.                                                      |
| `SESSION_INACTIVITE_MINUTES`        | `120`         | Session closes after this idle time, from 5 to 1440 minutes.                                          |
| `COOKIE_DOMAINE`                    | none          | Domain of the session cookie. Leave empty to use the host of the API.                                 |
| `COOKIE_SECURE`                     | `true`        | Mark the cookie `Secure`. Must be `true` in production.                                               |
| `TRUST_PROXY_HOPS`                  | `0`           | Number of reverse proxies in front of the API, from 0 to 10. Set it to the exact number.              |
| `ARGON2_MEMOIRE_KIB`                | `19456`       | Memory cost of the password hash, in KiB. Minimum 19456.                                              |
| `ARGON2_ITERATIONS`                 | `2`           | Time cost of the password hash. Minimum 2.                                                            |
| `ARGON2_PARALLELISME`               | `1`           | Parallelism of the password hash.                                                                     |
| `LIMITE_CONNEXION_IP`               | `20`          | Sign-in attempts allowed per IP address in the window.                                                |
| `LIMITE_CONNEXION_COMPTE`           | `15`          | Sign-in attempts allowed per account in the window. Must be greater than `SEUIL_VERROUILLAGE_COMPTE`. |
| `LIMITE_FENETRE_SECONDES`           | `900`         | Length of the sign-in window, in seconds. Minimum 30.                                                 |
| `SEUIL_VERROUILLAGE_COMPTE`         | `5`           | Failed passwords in a row before the account is locked for a while.                                   |
| `LIMITE_RECHERCHE_UTILISATEUR`      | `40`          | Search requests allowed per user in the window.                                                       |
| `LIMITE_RECHERCHE_FENETRE_SECONDES` | `30`          | Length of the search window, in seconds.                                                              |

## Outgoing e-mail

E-mail is sent for real only when `NODE_ENV=production` **and** `COURRIEL_ENVOI_REEL=true`. In every other case, messages are captured and not delivered.

| Variable              | Default | Effect                                                           |
| --------------------- | ------- | ---------------------------------------------------------------- |
| `COURRIEL_ENVOI_REEL` | `false` | Allow real sending, together with `NODE_ENV=production`.         |
| `SMTP_HOTE`           | none    | SMTP server host name.                                           |
| `SMTP_PORT`           | `587`   | SMTP port, from 1 to 65535.                                      |
| `SMTP_SECURISE`       | `false` | `true` for implicit TLS. Leave `false` for STARTTLS on port 587. |
| `SMTP_UTILISATEUR`    | none    | SMTP user name.                                                  |
| `SMTP_MOT_DE_PASSE`   | none    | SMTP password.                                                   |
| `SMTP_EXPEDITEUR`     | none    | Sender address. Must be a valid e-mail address.                  |

Each garage can set its own sending server in the app (**Settings > Sending e-mails**). Order of use: the garage's setting, then the `SMTP_*` variables above, then nothing: with neither, the e-mail is not sent and the screen shows "Not configured". Outside production, ordinary e-mails stay captured whatever the garage setting; only the test e-mail of that screen is really sent.

| Variable                         | Default | Effect                                                                                                                                                                                                                |
| -------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLE_CHIFFREMENT_SECRETS`        | none    | 32-byte key (base64 or 64 hex characters) that encrypts the garages' SMTP passwords. Without it, saving a password is refused. Generate with `openssl rand -base64 32`. Changing it means typing the passwords again. |
| `COURRIEL_RESEAU_PRIVE_AUTORISE` | `false` | Allow a garage's sending server on a private network (192.168.x, 10.x, localhost) in production. Off by default so the test button cannot probe the internal network. Always allowed outside production.              |

## Supervision

| Variable                             | Default    | Effect                                                                                  |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                         | none       | DSN of a Sentry-compatible server. When empty, error reporting is off.                  |
| `SENTRY_ENVIRONMENT`                 | `NODE_ENV` | Environment name shown in the error reports.                                            |
| `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` | `0`        | Share of requests traced for performance, from 0 to 1.                                  |
| `VERSION_APP`                        | computed   | Version shown in the health endpoint and in logs. Computed from the Git tag when empty. |
| `VERSION_APP_BRANCHE`                | computed   | Branch or tag that produced the build. Computed when empty.                             |

## Operator console

The console is off unless `DATABASE_URL_CONSOLE` is set.

| Variable                             | Default               | Effect                                                                      |
| ------------------------------------ | --------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL_CONSOLE`               | none                  | PostgreSQL URL for the role `dfa_console`. Setting it turns the console on. |
| `CONSOLE_COOKIE_NOM`                 | `dfa_console_session` | Name of the console session cookie.                                         |
| `CONSOLE_SESSION_DUREE_MINUTES`      | `60`                  | Maximum console session length, from 5 to 240 minutes.                      |
| `CONSOLE_SESSION_INACTIVITE_MINUTES` | `15`                  | Console idle timeout, from 1 to 120 minutes.                                |
| `CONSOLE_POOL_MAX`                   | `2`                   | Connections in the console pool, from 1 to 10.                              |

## Background jobs

Each scheduled job has an on/off switch and a cron expression. The cron expressions use UTC.

The switch accepts three states. When the variable is empty, the job is active in production and inactive in other environments. `true` forces it on, `false` forces it off.

| Variable                                  | Default      | Job                                                             |
| ----------------------------------------- | ------------ | --------------------------------------------------------------- |
| `REFERENTIEL_VEHICULES_CH_JOB_ACTIF`      | empty        | Daily update of the Swiss vehicle reference data.               |
| `REFERENTIEL_VEHICULES_CH_JOB_CRON`       | `17 4 * * *` | Schedule of the vehicle reference update.                       |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF`  | empty        | Automatic closing of the time clocking day.                     |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON`   | `30 0 * * *` | Schedule of the closing job.                                    |
| `RELANCES_FACTURE_JOB_ACTIF`              | empty        | Planning and sending of invoice reminders.                      |
| `RELANCES_FACTURE_JOB_CRON`               | `12 * * * *` | Schedule of the reminder job.                                   |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_ACTIF` | empty        | Automatic purge of a tenant's data after it leaves the service. |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_CRON`  | `17 3 * * *` | Schedule of the purge job.                                      |

## Document services

| Variable                               | Default                  | Effect                                                                                         |
| -------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `OCR_SERVICE_URL`                      | `http://ocr-permis:8092` | URL of the OCR service that reads vehicle registration documents.                              |
| `OCR_SERVICE_TIMEOUT_MS`               | `20000`                  | Time to wait for the vehicle OCR service, in milliseconds. Minimum 1000.                       |
| `LIMITE_OCR_PERMIS_UTILISATEUR`        | `15`                     | Vehicle OCR scans allowed per user in the window.                                              |
| `LIMITE_OCR_PERMIS_FENETRE_SECONDES`   | `300`                    | Length of the vehicle OCR window, in seconds.                                                  |
| `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` | none                     | URL of the OCR service that reads supplier invoices. Unset means the feature is not available. |
| `FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS`  | `20000`                  | Time to wait for the supplier invoice OCR service, in milliseconds. Minimum 1000.              |

## Web interface

| Variable                | Default | Effect                                                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `VITE_DFA_VERSION_INFO` | none    | Build-time text shown in the version footer of the interface. Set at build time, not at run time. |

## Deployment

These variables are read by the Compose file, not by the API. Set them in `.env`.

| Variable                                                                                                   | Default                 | Effect                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `DFA_VERSION`                                                                                              | `latest`                | Image tag to run: `X.Y.Z`, `X.Y`, `latest` or `edge`.                          |
| `DFA_SITE_ADDRESS`                                                                                         | `http://localhost`      | Site address. A domain name turns on HTTPS through Caddy.                      |
| `DFA_PUBLIC_URL`                                                                                           | `http://localhost:8080` | Public address of the site, used as `API_URL_PUBLIQUE` and `WEB_URL_PUBLIQUE`. |
| `DFA_HTTP_PORT`                                                                                            | `8080`                  | Host port for HTTP.                                                            |
| `DFA_HTTPS_PORT`                                                                                           | `8443`                  | Host port for HTTPS.                                                           |
| `DFA_TRUST_PROXY_HOPS`                                                                                     | `1`                     | Passed as `TRUST_PROXY_HOPS`.                                                  |
| `DFA_LOG_LEVEL`                                                                                            | `info`                  | Passed as `LOG_NIVEAU`.                                                        |
| `DFA_EXPOSE_API_DOCS`                                                                                      | `false`                 | Passed as `OPENAPI_EXPOSER_DOCS`.                                              |
| `DFA_SENTRY_DSN`                                                                                           | empty                   | Passed as `SENTRY_DSN`.                                                        |
| `DFA_SMTP_ENABLED`                                                                                         | `false`                 | Passed as `COURRIEL_ENVOI_REEL`.                                               |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_SECURE`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | see `.env.example`      | Passed as the `SMTP_*` variables.                                              |
| `DFA_SECRETS_KEY`, `DFA_SMTP_ALLOW_PRIVATE_NETWORK`                                                        | empty, `false`          | Passed as `CLE_CHIFFREMENT_SECRETS` and `COURRIEL_RESEAU_PRIVE_AUTORISE`.      |
| `DFA_TIMEZONE`                                                                                             | `UTC`                   | Time zone of the backup service.                                               |
| `AGE_CLE_PUBLIQUE`                                                                                         | empty                   | `age` public key for the backup profile.                                       |
| `HEURE_SAUVEGARDE`                                                                                         | `03:15`                 | Hour of the nightly backup.                                                    |
| `SEUIL_TAILLE_MIN_POURCENT`                                                                                | `50`                    | Minimum size of a backup, in percent of the previous one.                      |

:::caution
Check the variables against `.env.example` for the release you run. Variables can change between releases. Read the [changelog](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) before you upgrade.
:::
