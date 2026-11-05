---
title: Quick start
description: Start the dmsforall stack with Docker Compose and open the web interface.
---

At the end of this page, the dmsforall stack runs on your machine or server, and you can open the web interface in a browser.

## Steps

1. Get the deployment files and go to the project folder.

   ```sh
   git clone https://github.com/selfhostr/dmsforall.git && cd dmsforall
   ```

2. Optional for a first try on `localhost`: create the settings file. The defaults work without it.

   ```sh
   cp .env.example .env
   ```

3. Start the stack. The images are pulled from `ghcr.io/selfhostr`.

   ```sh
   docker compose up -d
   ```

4. Create the first garage account (see [Set up your first garage](first-garage.md)), then open http://localhost:8080 in a browser.

Result: the sign-in page loads. The first start generates the database passwords once, runs the migrations, then starts the API and the worker.

## Next steps

- For a server reachable from the Internet, set a domain and HTTPS: see [Install dmsforall on a server](installation.md).
- Create the first garage account with `creer-garage.js`: see [Set up your first garage](first-garage.md).
- Set up backups before you enter real data: see [Back up and restore](backup-and-restore.md).

:::caution
The stack has been defined and its files reviewed, but the complete install has not been run end to end on a clean machine with a real domain. Report any difference you find.
:::
