---
title: Back up and restore
description: Turn on the encrypted nightly backup of the database and the uploaded files, take a manual dump, and what has and has not been proven about restoring.
---

At the end of this page, you know how to turn on the nightly backup, how to take a dump by hand, and what the restore status is.

:::caution
The off-site copy has not been tested. Keep a second copy outside the server, and check it yourself.
:::

## Turn on the nightly backup

The backup runs in the `backup` profile. Every night it writes encrypted files to the volume `dmsforall_dfa_postgres_backups`. Each night produces three files with the same timestamp:

| File                                 | Content                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `dfa_<timestamp>.dump.age`           | The database: schema and data.                                              |
| `dfa_<timestamp>.roles.sql.age`      | The database roles, with their current passwords.                           |
| `dfa_<timestamp>.uploads.tar.gz.age` | The uploaded and generated files: invoice PDFs, repair order photos, exits. |

The three files are encrypted with the same `age` key, rotated together (7 daily, 4 weekly, 12 monthly) and copied off site together when `RCLONE_REMOTE` is set. The files archive is complete every night, not incremental: it is about as large as the files themselves once compressed (photos barely compress), and the volume keeps up to 23 copies. Size the volume for that.

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

## What is backed up

The backup container mounts the upload volumes read-only under `/uploads` and archives everything it finds there:

- `dmsforall_dfa_api_uploads`: invoice and other PDF documents.
- `dmsforall_dfa_photos_or`: repair order photos and their thumbnails.
- `dmsforall_dfa_exports_resiliation`: the exports handed to a garage that leaves. They can contain a whole garage's data and cannot always be generated again once the garage is gone.
- `dmsforall_dfa_reprise`: the archives uploaded to take over data from the previous software. They are the source of the takeover and cannot be regenerated.

A new uploads volume added to the `api` service in `docker-compose.yml` is not backed up until you also mount it, read-only, under `/uploads/` in the `backup` service.

The archive is written as a stream (`tar` into `age`): no clear text file is written to disk. The backup fails, and `dernier-statut.txt` says `ECHEC`, if the archive cannot be written or `/uploads` is missing.

## What is not backed up

- The Valkey data. Queues and short-lived state are recreated.
- The generated database passwords (volume `dmsforall_dfa_secrets`) and the TLS certificates (volume `dmsforall_dfa_caddy_data`). Keep a copy of the passwords somewhere safe.
- Files in an uploads directory that is not a mounted volume. They live in the container and are lost when it is recreated.

## Restore

A restore brings the database back to the time of the backup. Everything written after that backup is lost.

1. Stop the `api` and `worker` services, so that nothing writes to the database.
2. Restore the dump into an empty database on a separate machine first, and check the result.
3. Only then restore on the production server. A complete restore on a fresh installation has been proven.

`restaurer.sh` restores the database and the files together, as long as the `.uploads.tar.gz.age` file sits next to the `.dump.age` file:

```sh
AGE_CLE_PRIVEE_FICHIER=/path/to/age.key \
  docker/postgres/sauvegarde/restaurer.sh /path/to/dfa_20260101-031500.dump.age dfa --confirmer
```

- `--base-seule` restores the database only.
- `--fichiers-seuls` restores the files only. Pass `-` as the database name.

Files are extracted into the volumes of the `api` service. A file with the same name is overwritten, and a file that is not in the archive is left alone. The files are restored only when the target database is `dfa`; a trial restore into another database leaves the live files untouched.

The monthly restore test (`restaurer-test.sh`) decrypts and reads the whole files archive. It has not been run against a real archive in the automated tests yet; run it by hand once after you turn the backup on.

:::caution
`restaurer.sh` requires `age` on the host, with the private key. The stack must already be running before you restore.
:::
