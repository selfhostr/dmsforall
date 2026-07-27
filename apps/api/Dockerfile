# syntax=docker/dockerfile:1
#
# Image de production de l'API DFA (NestJS). Build multi-étapes, image finale minimale,
# utilisateur non-root, healthcheck intégré.
#
# CONTEXTE DE BUILD = RACINE DU MONOREPO, PAS apps/api. Ce n'est pas une option :
#   - pnpm workspaces résout `@dfa/shared` ("workspace:*", voir apps/api/package.json) via
#     pnpm-lock.yaml et pnpm-workspace.yaml, qui vivent à la racine. Un contexte limité à
#     apps/api ne verrait ni le lockfile, ni packages/shared, ni le fichier d'espace de
#     travail : `pnpm install --frozen-lockfile` échouerait immédiatement.
#   - Les paquets d'un monorepo pnpm sont reliés par des liens symboliques relatifs
#     (apps/api/node_modules/@dfa/shared -> ../../../packages/shared). Ces liens ne se
#     recréent correctement que si l'arborescence complète (racine + apps/api +
#     packages/shared) est installée ensemble, à la même profondeur relative.
#   - `packages/shared` est compilé en CommonJS et c'est cette forme compilée (dist/) que
#     l'API consomme au runtime — il faut donc pouvoir construire ce paquet avant l'API.
#
# Construire depuis la racine :
#   docker build -f apps/api/Dockerfile -t dfa-api:<tag> .
# (c'est exactement ce que fait docker-compose.yml : `build.context: .`)
#
# Le contexte remonte donc large : `.dockerignore` (apps/api/.dockerignore, tenu par le
# même propriétaire que ce Dockerfile) exclut node_modules/dist/tests/secrets en défense en
# profondeur, mais CE Dockerfile ne fait par ailleurs jamais `COPY . .` — chaque étape copie
# nommément les fichiers dont elle a besoin, pour que rien de superflu (et surtout aucun
# .env) n'entre dans une couche d'image même si l'ignore file était mal pris en compte par un
# outil tiers.

ARG NODE_VERSION=22-alpine

# --- Étape de base : Node + pnpm (via corepack), rien d'autre --------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
# corepack lit `packageManager` dans package.json (pnpm@11.17.0, voir racine) et installe
# exactement cette version — même pnpm en CI, en dev et en image de prod, aucune dérive.
RUN corepack enable
WORKDIR /repo

# --- Étape deps : installation complète (dev+prod), limitée à l'API + ses dépendances internes
# `--filter @dfa/api...` sélectionne @dfa/api ET tout ce dont il dépend en interne (ici
# @dfa/shared) — pas apps/web, jamais nécessaire pour construire l'API.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dfa/api...

# --- Étape build : compile @dfa/shared puis @dfa/api (nest build) ----------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/src packages/shared/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json apps/api/tsconfig.build.json
COPY apps/api/nest-cli.json apps/api/nest-cli.json
COPY apps/api/src apps/api/src
RUN pnpm --filter @dfa/shared build && pnpm --filter @dfa/api build
# `nest build` (tsc) ne compile QUE les .ts — les migrations SQL appliquées au démarrage par
# `dist/db/migrer.js` (voir src/db/migrer.ts:trouverRepertoireMigrations, qui cherche
# dist/db/migrations) doivent être copiées explicitement : nest-cli.json ne déclare pas
# d'"assets" pour l'instant. Seuls les fichiers .sql de premier niveau sont embarqués : le
# sous-dossier down/ (scripts de retour arrière manuels) reste dans le dépôt Git, consulté par
# @laupernoe au besoin plutôt que porté par l'image.
RUN mkdir -p apps/api/dist/db/migrations && \
    cp apps/api/src/db/migrations/*.sql apps/api/dist/db/migrations/

# --- Étape prod-deps : même filtre, SANS les devDependencies ---------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @dfa/api...

# --- Étape finale : runtime minimal, non-root -------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# Utilisateur applicatif dédié plutôt que `node` (uid 1000 partagé avec l'hôte sur certaines
# distros) : groupe et utilisateur système, sans shell de login, home réduit au strict besoin.
RUN addgroup -S dfa && adduser -S dfa -G dfa -h /repo -s /sbin/nologin

# node_modules pruned (prod uniquement), en préservant la même arborescence relative que la
# construction (racine + apps/api + packages/shared) : c'est ce qui permet aux liens
# symboliques pnpm de continuer à résoudre correctement une fois copiés.
COPY --from=prod-deps --chown=dfa:dfa /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=dfa:dfa /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps --chown=dfa:dfa /repo/apps/api/node_modules ./apps/api/node_modules

# Code compilé + manifest (le manifest est nécessaire à la résolution Node du champ "main"/
# "exports" de @dfa/shared).
COPY --from=build --chown=dfa:dfa /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=dfa:dfa /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=dfa:dfa /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=dfa:dfa /repo/apps/api/dist ./apps/api/dist

USER dfa
WORKDIR /repo/apps/api

# Port interne par défaut (PORT dans .env.example) ; en prod le reverse proxy est le seul point
# d'entrée public, ce port n'est jamais publié sur l'hôte (voir docker-compose.yml).
EXPOSE 3000

# Sonde de vie uniquement (GET /api/v1/sante, cf. sante.controller.ts) — ne dépend d'aucune
# ressource externe (Postgres/Redis), volontairement : un Postgres managé momentanément
# indisponible ne doit pas faire redémarrer le conteneur API en boucle. La disponibilité des
# dépendances (GET /api/v1/sante/pret) est réservée à la supervision externe (uptime check,
# voir docs/deploiement-production.md), pas au HEALTHCHECK Docker.
# `node -e` plutôt que curl/wget : évite d'ajouter un paquet à l'image (fetch global depuis
# Node 18+), l'image finale reste réduite à node + node_modules + dist.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Forme exec (pas de shell) : `node` devient PID 1 directement et reçoit SIGTERM sans
# intermédiaire — nécessaire pour un arrêt propre (`docker compose stop`, rolling restart).
CMD ["node", "dist/main.js"]
