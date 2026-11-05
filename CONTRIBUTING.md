# Contributing to dmsforall

Thank you for helping. This page explains how to run dmsforall for development, what CI checks, and which conventions every change follows. Open an issue first for a large change, so that we can agree on the approach before you write code.

## Development setup

You need Node.js 22 or later, pnpm 11 (pinned in `package.json`) and Docker with Compose v2. Docker runs PostgreSQL 16 and Redis for development. The API and the web interface run on your host.

```sh
cp .env.example .env
pnpm install
pnpm docker:up        # PostgreSQL and Redis (docker-compose.dev.yml, project dmsforall-dev)
pnpm db:migrate       # apply the migrations
pnpm db:seed          # load a demo garage
pnpm dev              # API on http://localhost:3000, web on http://localhost:5173
```

Open http://localhost:5173. The API documentation is available on http://localhost:3000/api/docs only when `OPENAPI_EXPOSER_DOCS=true` is set in `.env`.

Only one `.env` file exists, at the repository root. Vite reads `VITE_*` variables from it. Do not create `apps/web/.env`.

### Demo accounts

All demo accounts use the password `Demo1234!Garage`. The technician PIN for the workshop terminal is `1234`.

| Account                           | Role             | Use it for                                                                 |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `direction@garage-martin.ch`      | `direction`      | Everything. Use it to test invoicing.                                      |
| `admin@garage-martin.ch`          | `admin`          | Technical administration only. It has no financial, stock or sales rights. |
| `comptable@garage-martin.ch`      | `comptable`      | Payments, accounting export.                                               |
| `receptionniste@garage-martin.ch` | `receptionnaire` | Counter: quotes, invoices, payments.                                       |
| `chef.atelier@garage-martin.ch`   | `chef_atelier`   | Workshop: repair orders, quotes.                                           |
| `technicien@garage-martin.ch`     | `technicien`     | Time clocking.                                                             |
| `magasinier@garage-martin.ch`     | `magasinier`     | Parts stock.                                                               |
| `vendeur@garage-martin.ch`        | `vendeur`        | New and used car sales.                                                    |
| `borne.atelier@garage-martin.ch`  | `poste_atelier`  | Workshop terminal, PIN clocking.                                           |

Do not test the business flows with `admin@`. It returns `403` on purpose for financial and stock actions.

### Other useful commands

```sh
pnpm dev:api          # API only
pnpm dev:web          # web interface only
pnpm build            # production build of every package
pnpm api:openapi      # export the OpenAPI document
pnpm web:types        # generate the web types from the OpenAPI document
pnpm docker:reset     # remove the containers and volumes, then start again
```

Run `pnpm docker:reset`, then `pnpm db:migrate` and `pnpm db:seed`, to start from an empty database. If you change `docker/postgres/init/01-roles.sql`, you must run `docker compose down -v` first, because PostgreSQL runs that script only when its data volume is empty.

Do not run `pnpm api:openapi` while `pnpm dev` is running. Both write to the same build folder.

## Checks before a pull request

CI runs these checks on every pull request. Run them locally, in this order, before you push:

```sh
pnpm --filter @dfa/shared build      # the API type-checks against the built shared package
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @dfa/web i18n:check
pnpm test
```

Build `@dfa/shared` again after every change in `packages/shared`. Otherwise the API type-checks against an old `dist/` folder.

`pnpm test` passing does not mean that `pnpm typecheck` passes, because Vitest does not type-check. Run both.

CI also runs the production build, the integration tests on a throwaway PostgreSQL database (`pnpm test:integration`, which uses testcontainers and needs Docker), and a check that every migration can be reverted and applied again.

### Running one test file

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire apps/api/src/facturation/documents/numerotation.spec.ts
pnpm --filter @dfa/api exec vitest run --project unitaire -t "fragment of the test name" <path>
pnpm --filter @dfa/web exec vitest run <path>
```

Use `-t` to run one test by name. The web package has no `--project` flag.

## Branches and pull requests

- `main` is stable and receives changes only from `dev`, through a pull request.
- `dev` is where work lands. Open every pull request against `dev`.
- Work on a branch named `feat/<name>`, `fix/<name>`, `docs/<name>` or `chore/<name>`, created from `dev`.
- Keep one topic per pull request. A pull request that mixes a refactoring and a feature is sent back.
- A pull request needs passing checks and a review before it is merged. Changes to a shared contract (`packages/shared/src/contrats/`) or a new migration number must be agreed in the issue first, to avoid two migrations with the same number.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(facturation): add the credit note reason`.
- Sign off every commit with the Developer Certificate of Origin: `git commit -s`. The line `Signed-off-by: Your Name <you@example.com>` certifies that you have the right to submit the change under the MIT licence. Use your own name and address.

## Repository hygiene

This repository is public. Never commit:

- secrets, passwords, tokens, private keys or `.env` files;
- real client data, real vehicle identifiers or real bank details, including in test fixtures and seed data;
- real host names, public or private IP addresses, or personal file paths.

Use the reserved ranges for examples: `example.org`, `example.com`, `*.example` domains, `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, and the private range `10.0.0.0/8` only for placeholders.

Do not add tools or assistant files that record personal settings to the repository.

## Conventions

These rules apply to every change. Reviewers check them, and several are enforced by tests.

- **Tenant.** The tenant is always resolved from the session or the token, never from a query parameter or a request body. Every table has a `tenant_id NOT NULL` column and row-level security. Scope each query to the tenant in application code too. Row-level security is a safety net, not the mechanism.
- **Money.** Store amounts as integers in centimes. Never use floating-point numbers for money. Apply VAT per line, then add up the lines. A document that has been issued is locked. Correct it with a credit note only.
- **Database.** Use UUID primary keys, `timestamptz` for times, PostgreSQL enums, and JSONB only for attributes that really vary. Put constraints in the database.
- **Migrations.** Add a new file `apps/api/src/db/migrations/NNNN_name.sql` and its reverse script `apps/api/src/db/migrations/down/NNNN_name.down.sql`. Never edit a migration that has been applied or merged: the migrator stores a checksum of each file and refuses to run when it changes. Every migration must be reversible, and CI checks it. Use expand and contract for destructive changes.
- **Audit trail.** Sensitive entities (sales documents, repair orders, stock) record who changed what, when, and the values before and after.
- **API first.** Define the endpoint in the OpenAPI description before you build the screen. Use cursor pagination, `application/problem+json` for errors, and an idempotency key for sensitive creations. Keep existing endpoints compatible.
- **Generated types.** Never write the API types by hand. Run `pnpm api:openapi`, then `pnpm web:types`. Shared contracts live in `packages/shared/src/contrats/`.
- **Web state.** Use TanStack Query for server state. Each screen shows its loading, empty and error states.
- **Internationalisation.** French is the source language. Put no hard-coded text in a screen. Keys are grouped by domain, use ICU message format, and must exist in French, German and Italian. Use the vocabulary of Swiss garages, such as OR, VN/VO and MFK.
- **Configuration.** Each environment variable is declared and validated with zod in `apps/api/src/config/charger-config.ts` (or the module that owns it). The API refuses to start if a value is invalid. No service reads `process.env` directly.
- **Tests.** Test tenant isolation, financial arithmetic with exact values (never `toBeCloseTo`), state machines, and the role by action matrix. Integration tests use a real, throwaway PostgreSQL database. Never weaken a test to make it pass.
- **Code language.** Comments and documentation are in the language of the file they sit in. The public documentation is in English.
- **Wording.** Describe what the project does, in plain words. Do not use marketing adjectives about size or speed.

## Documentation

The public documentation is in `docs/`, published at https://dmsforall.selfhostr.io/docs/. Keep the page titles and descriptions in each page's front matter. When you change a behaviour, update the page that describes it in the same pull request, and check the whole page, not only the paragraph you changed.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Do not open a public issue for a security problem.

## Code of conduct

Everyone who takes part in this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
