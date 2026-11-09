---
title: Testare dmsforall
description: Eseguire i test unitari, i test di integrazione, un singolo file di test e il controllo di reversibilità delle migrazioni.
---

Alla fine di questa pagina potrà eseguire l'intera suite di test, un singolo file di test e i test di integrazione su un database usa e getta.

## Test unitari

```sh
pnpm test
```

Questo comando esegue i test unitari di ogni pacchetto. Vitest non verifica i tipi, quindi esegua anche `pnpm typecheck`.

## Un file di test

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire apps/api/src/facturation/documents/numerotation.spec.ts
```

Per eseguire un singolo test per nome, aggiunga `-t` con un frammento del nome:

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire -t "frammento del nome" apps/api/src/facturation/documents/numerotation.spec.ts
```

Il pacchetto web non ha il flag `--project`:

```sh
pnpm --filter @dfa/web exec vitest run apps/web/src/test/accessibilite/contraste-jetons.spec.ts
```

## Test di integrazione

```sh
pnpm test:integration
```

I test di integrazione avviano un database PostgreSQL usa e getta con testcontainers. Docker deve essere in esecuzione. Non usano mai il Suo database di sviluppo.

I test di integrazione richiedono i programmi `mdbtools` per i test sugli archivi Access. La CI li installa. Per eseguire la serie completa, li installi in locale.

## Reversibilità delle migrazioni

```sh
scripts/verifier-reversibilite-migrations.sh
```

Lo script applica ogni migrazione, la annulla con il suo script inverso e la applica di nuovo. La CI lo esegue a ogni modifica. Una migrazione che non può essere annullata fa fallire il controllo.

## Regole per i test

- Isolamento tra i tenant, aritmetica sugli importi, macchine a stati e matrice ruolo per azione devono avere dei test.
- I test sugli importi verificano valori esatti, mai approssimazioni.
- Un test di integrazione verifica la query reale, non un mock del livello database.
- Non indebolisca mai un test per farlo passare. Corregga il codice, oppure modifichi il test con una motivazione che la revisione accetta.
