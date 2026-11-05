---
title: Test dmsforall
description: Run the unit tests, the integration tests, a single test file, and the migration reversibility check.
---

At the end of this page, you can run the whole test suite, a single test file, and the integration tests on a throwaway database.

## Unit tests

```sh
pnpm test
```

This runs the unit tests of every package. Vitest does not check types, so run `pnpm typecheck` as well.

## One test file

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire apps/api/src/facturation/documents/numerotation.spec.ts
```

To run a single test by name, add `-t` with a fragment of the name:

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire -t "fragment of the name" apps/api/src/facturation/documents/numerotation.spec.ts
```

The web package has no `--project` flag:

```sh
pnpm --filter @dfa/web exec vitest run apps/web/src/test/accessibilite/contraste-jetons.spec.ts
```

## Integration tests

```sh
pnpm test:integration
```

The integration tests start a throwaway PostgreSQL database with testcontainers. Docker must be running. They never use your development database.

The integration tests need the `mdbtools` programs for the Access archive tests. The CI installs them. Install them locally to run the full set.

## Migration reversibility

```sh
scripts/verifier-reversibilite-migrations.sh
```

The script applies each migration, reverts it with its reverse script, and applies it again. CI runs it on every change. A migration that cannot be reverted fails the check.

## Test rules

- Tenant isolation, arithmetic on money, state machines and the role by action matrix must have tests.
- Money tests check exact values, never approximations.
- An integration test checks the real query, not a mock of the database layer.
- Never weaken a test to make it pass. Fix the code, or change the test with a reason that the review accepts.
