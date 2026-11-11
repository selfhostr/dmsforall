# syntax=docker/dockerfile:1
#
# API image (NestJS). Multi-stage, minimal final image, non-root user, built-in healthcheck.
# The same image runs the API and the background worker (see docker-compose.yml): only the
# command changes. The API container applies the database migrations when it starts.
#
# The build context is the repository root, not apps/api: pnpm resolves @dfa/shared through the
# root lockfile and workspace file.
#
#   docker build -f apps/api/Dockerfile -t ghcr.io/selfhostr/dmsforall:dev .

ARG NODE_IMAGE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

# --- base: Node + pnpm (corepack reads the version from package.json) ---
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /repo

# --- deps: full install (dev + prod) for the API and its internal dependencies ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dfa/api...

# --- build: compile @dfa/shared, then the API ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/tsconfig.build.json packages/shared/tsconfig.build.json
COPY packages/shared/src packages/shared/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json apps/api/tsconfig.build.json
COPY apps/api/nest-cli.json apps/api/nest-cli.json
COPY apps/api/src apps/api/src
RUN pnpm --filter @dfa/shared build && pnpm --filter @dfa/api build
# `nest build` only compiles TypeScript: the SQL migrations read by dist/db/migrer.js are copied
# by hand (top-level files only, the down/ scripts stay in the repository).
RUN mkdir -p apps/api/dist/db/migrations && \
    cp apps/api/src/db/migrations/*.sql apps/api/dist/db/migrations/

# --- prod-deps: same filter, without devDependencies ---
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @dfa/api...

# --- runtime: minimal, non-root ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# mdbtools reads the Microsoft Access archives of the data import (mdb-tables, mdb-schema and
# mdb-export are spawned as sub-processes). Two Alpine packages: the CLI lives in mdbtools-utils.
RUN apk add --no-cache mdbtools mdbtools-utils su-exec

# Fixed uid/gid (100/101) so that volume ownership stays predictable.
RUN addgroup -g 101 -S dfa && adduser -S -u 100 -G dfa -h /repo -s /sbin/nologin dfa

COPY --from=prod-deps --chown=dfa:dfa /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=dfa:dfa /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=dfa:dfa /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=dfa:dfa /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=dfa:dfa /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=dfa:dfa /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=dfa:dfa /repo/apps/api/dist ./apps/api/dist
COPY --chmod=0755 docker/entrypoint-api.sh /usr/local/bin/dfa-entrypoint

# Data directories. The bind mounts of docker-compose.yml shadow them with host folders created
# as root: the entrypoint gives them to dfa on start.
RUN mkdir -p /repo/apps/api/uploads/documents-pdf /repo/apps/api/uploads/exports-resiliation /repo/apps/api/uploads/photos-or /repo/apps/api/uploads/reprise && \
    chown -R dfa:dfa /repo/apps/api/uploads

# Version reported by GET /api/v1/sante. There is no .git directory in the image, so the build
# pipeline passes both values.
ARG VERSION_APP=0.0.0-image
ENV VERSION_APP=${VERSION_APP}
ARG VERSION_APP_BRANCHE=unknown
ENV VERSION_APP_BRANCHE=${VERSION_APP_BRANCHE}

# Nothing at runtime needs npm, npx, corepack or yarn: the entrypoint is sh, the healthcheck and
# the jobs (dist/main.js, dist/main-worker.js, dist/db/*.js, dist/cli/*.js) only call node.
# Removing them drops the CVEs of npm's bundled dependencies from the final image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# No USER line: the entrypoint starts as root only to hand the bind-mounted folders to dfa, then
# switches to dfa (su-exec) before anything else runs. The API and the worker never run as root.
WORKDIR /repo/apps/api

EXPOSE 3000

# Liveness only: it does not depend on PostgreSQL or Redis, so a database outage does not put
# the container in a restart loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dfa-entrypoint"]
CMD ["node", "dist/main.js"]
