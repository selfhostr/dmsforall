---
title: Upgrade dmsforall
description: Upgrade a production installation safely, with a backup, the migrations, a health check and a rollback plan.
---

At the end of this page, your installation runs the new version, and you know how to go back if something fails.

## Before you upgrade

1. Read the [changelog](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) for every version between yours and the new one. Note any change in configuration variables.
2. Take a backup, and check that it is complete. See [Back up and restore](../get-started/backup-and-restore.md).
3. Check the free disk space. The migrations and the backups need room.
4. Plan a short window, and tell your staff. Staff must not work during the upgrade.

## Upgrade

1. Set `DFA_VERSION` in `.env` to the new tag (add the line if the file has none). If the release notes mention a change in `docker-compose.yml`, download the new file from the release first. See [Verify the images](../security/verify-images.md).
2. Pull the new images and restart the stack:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. The `api` service applies the database migrations when it starts, and the `worker` waits for it. Check that the API is healthy:

   ```sh
   docker compose ps api
   docker compose logs api
   ```

4. Check the health endpoint:

   ```sh
   curl -s https://dmsforall.example.ch/api/v1/sante
   ```

5. Sign in and check one document of each area you use.

## If something fails

- **The migration failed.** The API does not start on the new version, and the previous version keeps running. Read the logs of the `api` service, fix the cause, and run the stack again.
- **The API does not start.** Read the logs. A configuration error lists each faulty variable. Fix the variable and start again.
- **The new version misbehaves.** Restore the backup taken before the upgrade. This is the supported way to return to the previous state.

:::caution
Do not run the reverse scripts of the migrations on a database that has received real data since the upgrade. Each reverse script is tested in development, but it can drop data written after the upgrade. Restore the backup instead.
:::

:::caution
Never edit a migration file that has already been applied. The migrator checks a checksum of each file and refuses to run when one has changed.
:::
