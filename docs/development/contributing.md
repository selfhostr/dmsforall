---
title: Contribute to dmsforall
description: How to set up a development environment, run the checks, and send a change for review.
---

The full guide is [CONTRIBUTING.md](https://github.com/selfhostr/dmsforall/blob/main/CONTRIBUTING.md) in the repository. This page gives the short version and the links that matter for the documentation.

## Set up a development environment

```sh
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm docker:*` drives `docker-compose.dev.yml`, which uses the Compose project name `dmsforall-dev`. It starts PostgreSQL and Redis only. Add `--profile containers` to run the whole development stack in containers.

The API runs on port 3000 and the web interface on port 5173. The demo accounts are listed in the contributing guide.

## Before you open a pull request

Run these checks in this order:

```sh
pnpm --filter @dfa/shared build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @dfa/web i18n:check
pnpm test
```

## Send a change

1. Branch from `dev`, with a name such as `feat/name`, `fix/name` or `docs/name`.
2. Write Conventional Commits, and sign off each commit with `git commit -s`.
3. Open a pull request against `dev`. Keep one topic per pull request.

## Keep the documentation right

The documentation is part of the change. When you change a behaviour, update the page that describes it, and read the whole page again, not only the paragraph you edited.

Documentation pages are in English. Interface strings are in French first, and then in German and Italian.

## Architecture and decisions

- [Architecture](https://github.com/selfhostr/dmsforall/blob/main/ARCHITECTURE.md): components, domains and conventions.
- [Design](https://github.com/selfhostr/dmsforall/blob/main/DESIGN.md): colours, typography, density and accessibility rules. In French.
- [Decision records](adr/): the decisions that shape the code.
