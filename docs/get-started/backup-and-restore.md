---
title: Back up and restore
description: The daily backup that runs by itself, how to take one by hand, how to restore it, and what is not covered.
---

At the end of this page, you know where the daily backups are, how to take one by hand, how to restore one, and what you still have to copy yourself.

## The daily backup

The `backup` service runs with the stack. Every day at 02:30 (server time, Europe/Zurich) it writes two files into the `./backups` folder, next to the Compose file:

| File                            | Content                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `dfa-<date>_<time>.sql.gz`      | The whole database: schema and data.                                          |
| `fichiers-<date>_<time>.tar.gz` | The uploaded and generated files: invoice PDFs, repair order photos, exports. |

Backups older than 14 days are deleted. Change the hour and the number of days with `DFA_BACKUP_TIME` and `DFA_BACKUP_KEEP_DAYS` in `.env`. The files archive is complete every night, not incremental, so size the disk for 14 copies of your documents.

To take a backup now:

```sh
docker compose exec -u dfa backup /scripts/sauvegarder.sh
```

:::caution
`./backups` is on the same machine as the data. A disk failure or a stolen server loses both. Copy the folder to another machine every day (`rsync`, `rclone`, a NAS), and keep a copy of `./data/secrets` with it.
:::

To encrypt the backups, set `DFA_BACKUP_AGE_PUBLIC_KEY` in `.env` to an [age](https://age-encryption.org) public key. The files then end in `.age`. Keep the private key off the server: without it, the backups cannot be read.

## What is in a backup, and what is not

The database dump and the files archive cover everything the application stores: documents, photos, the exports handed to a garage that leaves, and the archives uploaded to take over data from the previous software.

Not covered:

- `./data/secrets`, the generated passwords and the encryption key. The key protects the sending passwords that garages saved in the application: without it, they must be typed again. Copy this small folder somewhere safe once.
- `./data/valkey`. The queues and short-lived state are recreated.
- `./data/certs`, the HTTPS certificate. It is regenerated if missing.

## Restore

A restore brings the database back to the time of the backup. Everything written after it is lost. Run these commands in the folder of the Compose file.

1. Stop the services that write to the database:

   ```sh
   docker compose stop api worker
   ```

2. Restore the database from a backup file (the name of a file in `./backups`):

   ```sh
   docker compose exec -u dfa backup /scripts/restaurer.sh dfa-2026-11-10_023000.sql.gz
   ```

   The script loads the backup into a new database first, and only if that succeeds does it replace the current one. The current database is kept under the name `dfa_avant_restauration_<time>`, and the script prints the command that deletes it once you are satisfied. A damaged backup never destroys your current data. For an encrypted backup, decrypt it first (`age -d -i age.key -o backups/restore.sql.gz backups/dfa-....sql.gz.age`) and give that file.

3. Restore the files (optional, when documents are lost):

   ```sh
   sudo tar -xzf backups/fichiers-2026-11-10_023000.tar.gz -C data/fichiers
   ```

4. Start the services again:

   ```sh
   docker compose start api worker
   ```

To restore on a new server, copy the Compose file, `./data/secrets` and the two backup files there, start the stack once (`docker compose up -d`, then `docker compose stop api worker`), and run steps 2 to 4.

:::caution
A backup you never restored is not a backup. Restore one on a separate machine now, sign in, and open a document, before you enter real data.
:::
