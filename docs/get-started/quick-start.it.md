---
title: Avvio rapido
description: Avviare lo stack di dmsforall con Docker Compose e aprire l'interfaccia web.
---

Al termine di questa pagina, lo stack di dmsforall è in funzione sul Suo computer o server, e Lei può aprire l'interfaccia web in un browser.

Servono Docker Engine e Docker Compose 2.24 o successivo. La [pagina di installazione](installation.md) elenca gli altri requisiti.

## Passaggi

1. Scarichi il file Compose. È l'unico file necessario.

   ```sh
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Avvii lo stack. Le immagini vengono scaricate da `ghcr.io/selfhostr`. Per una prima prova su `localhost` non c'è nulla da configurare.

   ```sh
   docker compose up -d
   ```

3. Crei il primo account dell'autorimessa (vedere [Configurare la prima autorimessa](first-garage.md)), poi apra http://localhost:8080 in un browser.

Risultato: la pagina di accesso si carica. Al primo avvio vengono generate una volta sola le password del database e la chiave di cifratura, vengono eseguite le migrazioni, poi si avviano l'API e il worker.

## Passi successivi

- Per un server raggiungibile da Internet, imposti un dominio e HTTPS (un file `.env` di poche righe): vedere [Installare dmsforall su un server](installation.md).
- Crei il primo account dell'autorimessa con `creer-garage.js`: vedere [Configurare la prima autorimessa](first-garage.md).
- Imposti i backup prima di inserire dati reali: vedere [Eseguire il backup e il ripristino](backup-and-restore.md).

:::caution
Lo stack è stato definito e i suoi file sono stati verificati, ma l'installazione completa non è ancora stata eseguita dall'inizio alla fine su una macchina pulita con un dominio reale. Segnali le differenze che riscontra.
:::
