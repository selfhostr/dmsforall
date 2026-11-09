---
title: Build dmsforall
description: Build the packages, the API and the web interface, export the OpenAPI document, generate the web types, and build the container images.
---

At the end of this page, you can build every package, export the API contract, and build the two container images.

## Prerequisites

- Node.js 22 or later.
- pnpm 11, as pinned in `package.json`.
- Docker with Compose v2, for the database and the images.

## Install the dependencies

```sh
pnpm install --frozen-lockfile
```

The `--frozen-lockfile` flag makes the install fail if `pnpm-lock.yaml` does not match `package.json`.

## Build the packages

```sh
pnpm --filter @dfa/shared build
pnpm build
```

Build `@dfa/shared` first. The API and the web interface use its compiled output.

## Export the API contract and generate the web types

After you change a controller or a DTO, regenerate the OpenAPI document and the web types:

```sh
pnpm api:openapi
pnpm web:types
```

Do not run `pnpm api:openapi` while `pnpm dev` is running. Both write to the same build folder.

## Build the container images

To build the images of the stack from source, use the override file:

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml build
```

To build one image by hand, run from the repository root, because the Dockerfiles copy the workspace packages:

```sh
docker build -f apps/api/Dockerfile -t dmsforall:local .
docker build -f apps/web/Dockerfile -t dmsforall-web:local .
```

The API image also contains the `mdbtools` programs, which the data import needs.

## Check the result

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

For the full list of checks that CI runs, read [Testing](testing.md) and [Contributing](contributing.md).
