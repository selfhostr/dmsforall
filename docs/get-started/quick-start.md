---
title: Quick start
description: Start the dmsforall stack with one Docker Compose file and open the web interface.
---

At the end of this page, the dmsforall stack runs on your machine or server, and you can open the web interface in a browser.

You need Docker Engine and Docker Compose 2.24 or later. The [installation page](installation.md) lists the other requirements.

## Steps

1. Create an empty folder and download the Compose file into it. It is the only file you need.

   ```sh
   mkdir dmsforall && cd dmsforall
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Start the stack. The images are pulled from `ghcr.io/selfhostr`. There is nothing to configure and no folder to create.

   ```sh
   docker compose up -d
   ```

3. Read the one-time installation code that the API prints at its first start:

   ```sh
   docker compose logs api
   ```

   It looks like `K7QM-3XRB-9TNA`.

4. Open `https://<server address>:8443` in a browser. The certificate is self-signed: accept it once. The page **Create your garage** opens: enter the garage name, your name, your e-mail address, a password and the installation code. You are signed in and the setup assistant opens. See [Set up your first garage](first-garage.md).

Result: the page that creates your garage loads. The first start generates the passwords and the encryption key, creates the database and applies the migrations. Your data is in the `./data` folder and your backups in `./backups`, next to the Compose file.

## Next steps

- For a domain name with a real certificate, put your own reverse proxy in front: see [Install dmsforall on a server](installation.md).
- Create the first garage from the command line instead of the browser: see [Set up your first garage](first-garage.md).
- The daily backup is already on. Copy `./backups` to another machine, and test a restore: see [Back up and restore](backup-and-restore.md).
