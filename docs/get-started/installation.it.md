---
title: Installare dmsforall su un server
description: Impostazioni, HTTPS, servizi dello stack, profili facoltativi e verifiche per un'installazione di dmsforall.
---

Questa pagina descrive un'installazione su un server. L'[Avvio rapido](quick-start.md) presenta la versione breve per `localhost`.

Al termine di questa pagina, lo stack è in funzione sul Suo server, e Lei ha verificato che risponde.

## Requisiti

- Docker Engine e Docker Compose v2.
- Per HTTPS su un dominio: un nome DNS che punta al server, e le porte 80 e 443 aperte verso Internet.
- Spazio su disco per i dati di PostgreSQL, i backup e i documenti caricati.

## Impostazioni

Accanto a `docker-compose.yml` crei un file chiamato `.env`. Parta da `.env.example`, allegato a ogni [release](https://github.com/selfhostr/dmsforall/releases/latest), e rimuova il `#` davanti alle righe che Le servono. Non è richiesto nulla: ogni impostazione ha un valore predefinito. Le più comuni sono:

| Variabile              | Predefinito             | Effetto                                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `DFA_SITE_ADDRESS`     | `http://localhost`      | Indirizzo del sito. Imposti un nome di dominio per ottenere HTTPS.                               |
| `DFA_PUBLIC_URL`       | `http://localhost:8080` | Indirizzo pubblico che gli utenti digitano nel browser. Deve corrispondere a `DFA_SITE_ADDRESS`. |
| `DFA_HTTP_PORT`        | `8080`                  | Porta dell'host per HTTP.                                                                        |
| `DFA_HTTPS_PORT`       | `8443`                  | Porta dell'host per HTTPS.                                                                       |
| `DFA_VERSION`          | `latest`                | Versione dell'immagine da eseguire.                                                              |
| `DFA_TRUST_PROXY_HOPS` | `1`                     | Numero di reverse proxy davanti all'API.                                                         |

La posta elettronica in uscita si imposta con `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD` e `DFA_SMTP_FROM`. L'invio si attiva automaticamente non appena viene impostato l'host. Le altre impostazioni si trovano nel [riferimento della configurazione](../reference/configuration.md).

Lei non inserisce mai un segreto. Il servizio `init-secrets` genera al primo avvio le password del database e la chiave che cifra le password salvate, e le conserva nel volume `dfa_secrets`. I ruoli e le stringhe di connessione del database derivano da queste. Conservi una copia del contenuto di quel volume: vedere [Eseguire il backup e il ripristino](backup-and-restore.md).

## HTTPS

Quando `DFA_SITE_ADDRESS` è un nome di dominio, Caddy ottiene e rinnova da solo il certificato Let's Encrypt. Le porte 80 e 443 devono raggiungere il server.

:::caution
HTTPS con un dominio reale non è ancora stato verificato dall'inizio alla fine. Controlli il certificato dopo il primo avvio e, se manca, legga i log di Caddy.
:::

## I servizi

| Servizio       | Ruolo                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| `proxy`        | Caddy. Pubblica le porte HTTP e HTTPS e instrada le richieste.           |
| `web`          | L'interfaccia web.                                                       |
| `api`          | L'API. Non pubblicata.                                                   |
| `worker`       | Lavori in background, dalla stessa immagine dell'API.                    |
| `migrate`      | Applica le migrazioni del database prima dell'avvio dell'API.            |
| `postgres`     | PostgreSQL 16. Non pubblicato.                                           |
| `redis`        | Valkey. Non pubblicato.                                                  |
| `init-secrets` | Genera una sola volta le password del database e la chiave di cifratura. |

PostgreSQL e Valkey non vengono mai pubblicati su una porta dell'host.

## Profili facoltativi

- `--profile ocr`: avvia l'immagine `ghcr.io/selfhostr/dmsforall-ocr`, che legge i documenti di immatricolazione dei veicoli. Questo profilo non è ancora stato avviato.
- `--profile backup`: avvia i backup cifrati notturni, dall'immagine `ghcr.io/selfhostr/dmsforall-backup`. Richiede `AGE_CLE_PUBLIQUE` in `.env`. Vedere [Eseguire il backup e il ripristino](backup-and-restore.md).

```sh
docker compose --profile backup up -d
```

## Compilare dai sorgenti

Per compilare le immagini da un clone del repository invece di scaricarle:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Creare la prima autorimessa

Una volta avviato lo stack, crei il primo account dell'autorimessa. Vedere [Configurare la prima autorimessa](first-garage.md) per il comando e le sue opzioni.

## Verificare l'installazione

```sh
docker compose ps
curl -s http://localhost:8080/api/v1/sante
```

Per un server, sostituisca `localhost:8080` con il Suo dominio. Risultato atteso: `postgres` e `redis` sono in stato healthy, `migrate` è terminato senza errori, `api` e `worker` sono in esecuzione, e l'endpoint di stato restituisce un documento JSON.

:::caution
Lasci `OPENAPI_EXPOSER_DOCS` non impostata oppure su `false` su un server raggiungibile da Internet.
:::
