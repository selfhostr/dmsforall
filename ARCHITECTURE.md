# Architecture

This document describes how dmsforall is built. It is written for developers and operators. For the reasons behind some choices, read the decision records in [docs/development/adr/](docs/development/adr/). For the business rules, read the code in `apps/api/src/` and the contracts in `packages/shared/src/contrats/`.

## Components

| Component          | Technology                                    | Where                                                      |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------- |
| Web interface      | React, Vite, shadcn/ui, TanStack Query        | `apps/web/`                                                |
| API                | NestJS, TypeScript (strict)                   | `apps/api/`                                                |
| Worker             | The same NestJS code, started in worker mode  | `apps/api/src/main-worker.ts`                              |
| Database           | PostgreSQL 16, Drizzle ORM                    | `apps/api/src/db/`                                         |
| Queue and realtime | Redis, BullMQ                                 | `apps/api/src/ordonnancement/`, `apps/api/src/temps-reel/` |
| Shared contracts   | TypeScript package                            | `packages/shared/`                                         |
| Reverse proxy      | Caddy, in front of the web and API containers | `docker-compose.yml`                                       |

The web interface is a client of the public API and has no privileged access to the database. Each feature exists as an endpoint in the OpenAPI description before it has a screen.

## Process modes

The API process runs in one of three modes, set with `MODE_PROCESSUS`:

- `api`: serves HTTP and registers no queue consumer.
- `worker`: runs the background jobs. It has no business HTTP server, only a minimal health probe on `PORT`.
- `combine` (default): both, in one process. `pnpm dev` uses this mode.

Code that only adds jobs to a queue works in every mode.

## Multi-tenancy

- Each garage is a tenant. Every tenant table has a `tenant_id NOT NULL` column.
- PostgreSQL row-level security (RLS) filters every tenant table. The application also scopes each query to the tenant explicitly. RLS is a safety net, not the only mechanism.
- The tenant comes from the session or the token, never from a request parameter.
- The API connects as `dfa_app`, a role subject to RLS. Migrations run as `dfa_migrator`, which the API never uses at run time. The optional operator console connects as `dfa_console`, a role with `NOBYPASSRLS`.
- Operations that run before a tenant is known (bootstrap) go through a limited set of `SECURITY DEFINER` functions in a dedicated schema.

## Business domains

Each domain is a folder under `apps/api/src/`, with its module, controllers, services and tests:

- `atelier`: repair orders with labour, parts and fee lines, statuses, time clocking on orders, inspection dates, courtesy cars, documents.
- `clients`, `vehicules`: clients, vehicles, owner history, registration document scanning (OCR), and a Swiss vehicle reference data import.
- `rendezvous`: appointments, appointment reasons, capacity per site.
- `pointage`: time clocking rules and the end-of-day closing job.
- `facturation`: quotes, orders, invoices, credit notes, payments, the Swiss QR-bill, PDF generation, accounting exports (WinBIZ).
- `pieces`: articles, stock per site, stock movements, reservations, supplier orders and supplier invoices, core exchanges.
- `ventes`: vehicle stock for sale, sales files, trade-ins, financing and leasing.
- `pneus`: tyre storage and seasonal changes.
- `relances`: planned reminders for overdue invoices, and their sending by e-mail.
- `reprise`: data import from an Access or dBase/FoxPro archive, in steps: upload, detection, profiling, plan, write, report.
- `tableau-bord`: dashboard figures, with separate rights for workshop and financial figures.
- `parametrage`: sites, references, numbering counters, invoice settings, users and roles.
- `auth`: sessions, passwords, login limits, the rights matrix.
- `socle`: tenants, sites, users. `common`: shared errors, rights guard, pagination, time helpers.
- `connecteurs`: the connector registry and its resilience layer. Only stub adapters are wired. No third-party provider is connected in this version.
- `courriel`: outgoing e-mail. The SMTP transport sends real messages only when `NODE_ENV=production` and `COURRIEL_ENVOI_REEL=true`. Otherwise messages are captured.
- `exploitation`: the operator console, the tenant offboarding export and purge, platform health.
- `observabilite`, `sante`, `openapi`, `config`, `db`: logging and optional error reporting, health, OpenAPI export, configuration, database access.

## API conventions

- Base path `/api/v1/` (URI versioning, default version `1`).
- The OpenAPI description is generated from the controllers and DTOs. The interactive documentation is served at `/api/docs` only when `OPENAPI_EXPOSER_DOCS=true`.
- Errors use the `application/problem+json` format.
- Lists use cursor pagination.
- Sensitive creations accept an idempotency key.
- Authorisation uses one mechanism: the `@ExigerDroit(...)` decorator and the `GardeDroit` guard. Both read the rights matrix in `apps/api/src/auth/matrice-droits.ts`, which is typed by role.

## Money and documents

- Amounts are integers in centimes. Floating-point numbers never hold money.
- VAT is calculated per line, then added up per document. Rates are stored per mille (for example 81 for 8.1%).
- An issued invoice is locked. A correction is a credit note.
- Sensitive entities (sales documents, repair orders, stock) keep an audit trail: who, what, when, and the values before and after.
- The QR-bill is generated with the `swissqrbill` library.

## Frontend

- Server state goes through TanStack Query. The API types are generated from the OpenAPI description with `pnpm web:types`, never written by hand.
- Interface strings come from translation keys in `apps/web/src/i18n/`. French is the source language. German and Italian are checked for completeness by `pnpm --filter @dfa/web i18n:check`.
- The design system is described in [DESIGN.md](DESIGN.md). That document is written in French.

## Persistence and migrations

- Tables use UUID keys, `timestamptz` times and PostgreSQL enums. JSONB is kept for attributes that really vary.
- Migrations are SQL files in `apps/api/src/db/migrations/`, each with a reverse script in `down/`. The migrator stores a checksum of every applied file and refuses to run if one has changed.
- CI applies each migration, reverts it, and applies it again.

## Security

This section is a summary. The full description is in [docs/security/](docs/security/).

- The session cookie is HTTP-only and is marked `Secure` by default. Passwords are hashed with Argon2id.
- Login attempts are limited per IP address and per account, with counters in Redis.
- Configuration is validated with zod at start-up. The API refuses to start with an invalid configuration and lists every faulty variable.
- In production, the API refuses the development database passwords.

## Observability

Logs are JSON, written with pino. Errors go to a Sentry-compatible server when `SENTRY_DSN` is set. Without it, error reporting is off and the API still starts. Health is served at `/api/v1/sante`.

## Testing

- Unit tests run with Vitest: `pnpm test`.
- Integration tests run with Vitest and testcontainers against a throwaway PostgreSQL database: `pnpm test:integration`.
- Tenant isolation and the rights matrix have tests that every change must keep passing.

See [docs/development/](docs/development/) for the development guide.
