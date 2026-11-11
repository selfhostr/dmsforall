---
title: Installare dmsforall su un server
description: Installare dmsforall con un solo file Compose, mettere davanti il proprio reverse proxy per HTTPS su un dominio, e verificare l'installazione.
---

Questa pagina descrive un'installazione su un server. L'[Avvio rapido](quick-start.md) presenta la versione breve.

Al termine di questa pagina, lo stack è in funzione sul Suo server, dietro il Suo reverse proxy HTTPS se ne ha uno, e Lei ha verificato che risponde.

## Requisiti

- Docker Engine e Docker Compose 2.24 o successivo.
- Spazio su disco per il database, i documenti caricati e i backup.
- Per un nome di dominio con un certificato reale: un reverse proxy proprio (Caddy, nginx, Traefik, un tunnel Cloudflare).

## Installare

Crei una cartella vuota, vi scarichi il file Compose e avvii lo stack. Quel file è tutto ciò che serve. Non crei nessun altro file né sottocartella.

```sh
mkdir dmsforall && cd dmsforall
curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
docker compose up -d
```

Apra `https://<indirizzo del server>:8443`. dmsforall pubblica una sola porta, solo in HTTPS, con un certificato autofirmato generato al primo avvio. Il browser Le chiede di accettarlo una volta. Per un certificato reale, metta davanti un reverse proxy (vedere sotto).

Il primo avvio genera le password e le chiavi, crea il database, applica le migrazioni e avvia tutti i servizi. Tutto viene conservato accanto al file Compose:

| Cartella          | Contenuto                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| `./data/postgres` | Il database.                                                                       |
| `./data/valkey`   | Le code dei lavori in background.                                                  |
| `./data/fichiers` | Documenti e foto caricati e generati.                                              |
| `./data/secrets`  | Password generate e chiave di cifratura. Ne conservi una copia in un luogo sicuro. |
| `./data/certs`    | Il certificato HTTPS (`cert.pem`, `key.pem`).                                      |
| `./backups`       | I backup giornalieri.                                                              |

Sono semplici cartelle (bind mount), non volumi Docker: Lei le vede, le copia e le salva con i Suoi strumenti abituali. Docker le crea con il proprietario corretto al primo avvio. Non esegua né `mkdir` né `chown`.

## Creare la prima autorimessa

Una nuova installazione non ha ancora nessun account. Crei la prima autorimessa e il suo primo account con un solo comando: vedere [Configurare la prima autorimessa](first-garage.md). Poi acceda all'indirizzo qui sopra. L'assistente di configurazione che guida le impostazioni dell'autorimessa si avvia dopo il primo accesso.

## HTTPS con il proprio reverse proxy

dmsforall non gestisce i nomi di dominio né Let's Encrypt. Per servirlo su un dominio con un certificato valido, metta davanti il Suo reverse proxy. Deve inoltrare a `https://127.0.0.1:8443` e accettare il certificato autofirmato a monte (oppure Lei mette i Suoi `cert.pem` e `key.pem` in `./data/certs` e riavvia `web`).

Imposti l'indirizzo pubblico in `.env`, poi riavvii:

```sh
DFA_PUBLIC_URL=https://dmsforall.example.ch
```

Caddy (ottiene da solo il certificato):

```text
dmsforall.example.ch {
  reverse_proxy https://127.0.0.1:8443 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
```

nginx:

```nginx
location / {
  proxy_pass https://127.0.0.1:8443;
  proxy_ssl_verify off;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 1g;
}
```

Tunnel Cloudflare (`cloudflared`), nel file di configurazione:

```yaml
ingress:
  - hostname: dmsforall.example.ch
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Il cookie di sessione è sempre `Secure`: usi il sito solo tramite HTTPS. Con un reverse proxy davanti, l'API considera attendibili due salti di proxy (il Suo e il container `web`). Senza `DFA_PUBLIC_URL`, ne considera attendibile uno.

## Impostazioni facoltative

Non è richiesto nulla. Per modificare un'impostazione, crei un file chiamato `.env` accanto a `docker-compose.yml`, partendo da `.env.example` (allegato a ogni [release](https://github.com/selfhostr/dmsforall/releases/latest)), e rimuova il `#` davanti alle righe che Le servono.

| Variabile                                                                               | Predefinito    | Effetto                                                                           |
| --------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                           | `latest`       | Versione dell'immagine da eseguire.                                               |
| `DFA_PORT`                                                                              | `8443`         | La porta HTTPS pubblicata.                                                        |
| `DFA_PUBLIC_URL`                                                                        | nessuno        | Indirizzo pubblico dietro il Suo reverse proxy. Usato nei link delle e-mail.      |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | nessuno, `587` | Posta elettronica in uscita. L'invio si attiva non appena viene impostato l'host. |
| `DFA_BACKUP_TIME`                                                                       | `02:30`        | Ora del backup giornaliero (ora del server).                                      |
| `DFA_BACKUP_KEEP_DAYS`                                                                  | `14`           | Giorni di backup conservati.                                                      |

Le altre impostazioni si trovano nel [riferimento della configurazione](../reference/configuration.md).

## I servizi

| Servizio   | Ruolo                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `web`      | L'interfaccia web in HTTPS. L'unica porta pubblicata. Inoltra `/api` all'API.                              |
| `api`      | L'API. Applica le migrazioni del database all'avvio. Non pubblicata.                                       |
| `worker`   | Lavori in background, dalla stessa immagine dell'API. Si avvia quando l'API è healthy.                     |
| `postgres` | PostgreSQL 16. Non pubblicato.                                                                             |
| `valkey`   | Valkey (open source, compatibile con Redis). Non pubblicato.                                               |
| `backup`   | Il backup giornaliero, in `./backups`. Vedere [Eseguire il backup e il ripristino](backup-and-restore.md). |

Il profilo `ocr` avvia lo scanner dei documenti di immatricolazione: `docker compose --profile ocr up -d`. L'applicazione funziona anche senza, manca solo la scorciatoia «scansiona il documento di immatricolazione».

## Compilare dai sorgenti

Per compilare le immagini da un clone del repository invece di scaricarle:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Verificare l'installazione

```sh
docker compose ps
curl -k https://localhost:8443/api/v1/sante
```

Risultato atteso: tutti i servizi sono healthy (`worker` e `backup` dopo qualche secondo), e l'endpoint di stato restituisce un documento JSON. Sostituisca `localhost:8443` con il Suo indirizzo.

:::caution
I dati in `./data/postgres` e le password in `./data/secrets` vanno insieme. Se elimina o sostituisce uno senza l'altro, l'API rifiuta di avviarsi e Le indica quale cartella ripristinare. Non elimini mai `./data/secrets` da solo.
:::

:::caution
Lasci `OPENAPI_EXPOSER_DOCS` non impostata oppure su `false` su un server raggiungibile da Internet.
:::
