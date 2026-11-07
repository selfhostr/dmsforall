---
title: Back up and restore
description: Turn on the encrypted nightly backup, take a manual dump, and what has and has not been proven about restoring.
---

At the end of this page, you know how to turn on the nightly backup, how to take a dump by hand, and what the restore status is.

:::caution
The off-site copy has not been tested. Keep a second copy outside the server, and check it yourself.
:::

## Turn on the nightly backup

The backup runs in the `backup` profile. It writes encrypted dumps every night to the volume `dmsforall_dfa_postgres_backups`.

1. Put an `age` public key in `.env`:

   ```sh
   AGE_CLE_PUBLIQUE=age1...
   ```

2. Start the profile:

   ```sh
   docker compose --profile backup up -d
   ```

Keep the `age` private key off this server. Without it, the backups cannot be read. The backup is built from the repository, so keep a clone of it on the server.

The backup hour is set with `HEURE_SAUVEGARDE` (default `03:15`) and the time zone with `DFA_TIMEZONE` (default `UTC`).

## Take a dump by hand

For a one-off copy of the database, use `pg_dump` in the Postgres container:

```sh
docker compose exec postgres pg_dump -U dfa -Fc dfa > dfa-$(date +%Y%m%d).dump
```

Store the file encrypted and outside the server.

## What is not backed up

- The uploaded documents, in the volume `dmsforall_dfa_api_uploads`. Check the backup scope before you rely on it.
- The repair order photos and their thumbnails, in the volume `dmsforall_dfa_photos_or`. The nightly backup does not cover it either.
- The archives uploaded for a data takeover from your previous software, in the volume `dmsforall_dfa_reprise`. The nightly backup mounts this volume read-only but does not copy it: it only dumps the database.
- The Redis data. Queues and short-lived state are recreated.

## Restore

A restore brings the database back to the time of the backup. Everything written after that backup is lost.

1. Stop the `api` and `worker` services, so that nothing writes to the database.
2. Restore the dump into an empty database on a separate machine first, and check the result.
3. Only then restore on the production server. A complete restore on a fresh installation has been proven.

:::caution
`restaurer.sh` requires `age` on the host, with the private key. The stack must already be running before you restore.
:::
