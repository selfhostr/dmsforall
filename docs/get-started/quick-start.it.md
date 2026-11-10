---
title: Avvio rapido
description: Avviare lo stack di dmsforall con un solo file Docker Compose e aprire l'interfaccia web.
---

Al termine di questa pagina, lo stack di dmsforall è in funzione sul Suo computer o server, e Lei può aprire l'interfaccia web in un browser.

Servono Docker Engine e Docker Compose 2.24 o successivo. La [pagina di installazione](installation.md) elenca gli altri requisiti.

## Passaggi

1. Crei una cartella vuota e vi scarichi il file Compose. È l'unico file necessario.

   ```sh
   mkdir dmsforall && cd dmsforall
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Avvii lo stack. Le immagini vengono scaricate da `ghcr.io/selfhostr`. Non c'è nulla da configurare e nessuna cartella da creare.

   ```sh
   docker compose up -d
   ```

3. Crei il primo account dell'autorimessa (vedere [Configurare la prima autorimessa](first-garage.md)), poi apra `https://<indirizzo del server>:8443` in un browser. Il certificato è autofirmato: lo accetti una volta.

Risultato: la pagina di accesso si carica. Il primo avvio genera le password e la chiave di cifratura, crea il database e applica le migrazioni. I Suoi dati sono nella cartella `./data` e i backup in `./backups`, accanto al file Compose.

## Passi successivi

- Per un nome di dominio con un certificato reale, metta davanti il Suo reverse proxy: vedere [Installare dmsforall su un server](installation.md).
- Crei il primo account dell'autorimessa con `creer-garage.js`: vedere [Configurare la prima autorimessa](first-garage.md).
- Il backup giornaliero è già attivo. Copi `./backups` su un'altra macchina e provi un ripristino: vedere [Eseguire il backup e il ripristino](backup-and-restore.md).
