---
title: Compilare dmsforall
description: Compilare i pacchetti, l'API e l'interfaccia web, esportare il documento OpenAPI, generare i tipi per il web e compilare le immagini dei container.
---

Alla fine di questa pagina potrà compilare tutti i pacchetti, esportare il contratto dell'API e compilare le due immagini dei container.

## Prerequisiti

- Node.js 22 o successivo.
- pnpm 11, come fissato in `package.json`.
- Docker con Compose v2, per il database e le immagini.

## Installare le dipendenze

```sh
pnpm install --frozen-lockfile
```

Il flag `--frozen-lockfile` fa fallire l'installazione se `pnpm-lock.yaml` non corrisponde a `package.json`.

## Compilare i pacchetti

```sh
pnpm --filter @dfa/shared build
pnpm build
```

Compili prima `@dfa/shared`. L'API e l'interfaccia web usano il suo output compilato.

## Esportare il contratto dell'API e generare i tipi per il web

Dopo una modifica a un controller o a un DTO, rigeneri il documento OpenAPI e i tipi per il web:

```sh
pnpm api:openapi
pnpm web:types
```

Non esegua `pnpm api:openapi` mentre `pnpm dev` è in esecuzione. Entrambi scrivono nella stessa cartella di compilazione.

## Compilare le immagini dei container

Per compilare le immagini dello stack dal codice sorgente, usi il file di override:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

Per compilare a mano una singola immagine, esegua il comando dalla radice del repository, perché i Dockerfile copiano i pacchetti del workspace:

```sh
docker build -f apps/api/Dockerfile -t dmsforall:local .
docker build -f apps/web/Dockerfile -t dmsforall-web:local .
```

L'immagine dell'API contiene anche i programmi `mdbtools`, necessari all'importazione dei dati.

## Verificare il risultato

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

Per l'elenco completo dei controlli eseguiti dalla CI, legga [Test](testing.md) e [Contribuire](contributing.md).
