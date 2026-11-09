---
title: Contribuire a dmsforall
description: Come preparare un ambiente di sviluppo, eseguire i controlli e inviare una modifica per la revisione.
---

La guida completa è [CONTRIBUTING.md](https://github.com/selfhostr/dmsforall/blob/main/CONTRIBUTING.md) nel repository. Questa pagina riassume i passi essenziali e i collegamenti utili per la documentazione.

## Preparare un ambiente di sviluppo

```sh
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm docker:*` usa `docker-compose.dev.yml`, che usa il nome di progetto Compose `dmsforall-dev`. Avvia solo PostgreSQL e Valkey. Aggiunga `--profile containers` per eseguire l'intero stack di sviluppo nei container.

L'API è in esecuzione sulla porta 3000 e l'interfaccia web sulla porta 5173. Gli account demo sono elencati nella guida per i contributori.

## Prima di aprire una pull request

Esegua questi controlli in quest'ordine:

```sh
pnpm --filter @dfa/shared build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @dfa/web i18n:check
pnpm test
```

## Inviare una modifica

1. Crei un ramo da `dev`, con un nome come `feat/nome`, `fix/nome` o `docs/nome`.
2. Scriva i commit secondo le Conventional Commits, e firmi ogni commit con `git commit -s`.
3. Apra una pull request verso `dev`. Un argomento per pull request.

## Mantenere la documentazione corretta

La documentazione fa parte della modifica. Quando cambia un comportamento, aggiorni la pagina che lo descrive e rilegga tutta la pagina, non solo il paragrafo modificato.

Le pagine della documentazione sono in inglese. Le stringhe dell'interfaccia sono scritte prima in francese, poi in tedesco e in italiano.

## Architettura e decisioni

- [Architettura](https://github.com/selfhostr/dmsforall/blob/main/ARCHITECTURE.md): componenti, domini e convenzioni.
- [Design](https://github.com/selfhostr/dmsforall/blob/main/DESIGN.md): colori, tipografia, densità e regole di accessibilità. In francese.
- [Decisioni di architettura (ADR)](adr/): le decisioni che plasmano il codice.
