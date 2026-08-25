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
COPY packages/shared/tsconfig.build.json packages/shared/tsconfig.build.json
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

# mdbtools : lecture des archives Microsoft Access (.mdb/.accdb, format Jet) invoquée en
# sous-processus par apps/api/src/reprise/lecteurs/access/ (spawn de mdb-tables, mdb-schema,
# mdb-export — voir executeur-processus.ts). DEUX paquets Alpine distincts, pas un seul : mesuré en
# exécution (`apk info -L mdbtools` ne contient QUE libmdb*.so/libmdbsql*.so, les binaires mdb-*
# vivent dans `mdbtools-utils`) — piège classique de split lib/CLI sur Alpine, vérifié plutôt que
# supposé. Installé dans L'ÉTAPE RUNTIME, jamais seulement build/deps : un outil système ajouté au
# stage de compilation mais absent de l'image finale ne se voit qu'en production, au premier import
# qui tente de lire une base Access — erreur classique. `--no-cache` : aucun index apk résiduel
# dans la couche, cohérent avec l'image minimale déjà visée par ce Dockerfile. Placé avant la
# création de l'utilisateur applicatif ci-dessous : couche stable, invalidée seulement si la liste
# de paquets change, jamais par le reste de cette étape.
#
# Coût mesuré (docker history, build local node:22-alpine) : +410 kB de couche, 582 Mo -> 583 Mo
# sur l'image totale.
#
# Encodage des bases Access 97/Jet3 héritées (texte mono-octet, ex. CP1252) : `MDB_JET3_CHARSET`,
# lu par libmdb via getenv (mesuré : `strings libmdb.so.3` le montre littéralement, aucune option
# --charset en CLI dans cette version 1.0.1). Sans effet sur Jet4+/.accdb (Access 2000+), qui
# stocke déjà en UTF-16 — la variable est fixée par apps/api/src/reprise/lecteurs/access/
# lecteur-access.ts (CHARSET_JET3_PAR_DEFAUT), pas ici : ce Dockerfile ne fait qu'installer
# l'outil, jamais sa configuration d'appel.
RUN apk add --no-cache mdbtools mdbtools-utils

# Utilisateur applicatif dédié plutôt que `node` (uid 1000 partagé avec l'hôte sur certaines
# distros) : groupe et utilisateur système, sans shell de login, home réduit au strict besoin.
#
# uid/gid ÉPINGLÉS explicitement (-u 100 / -g 101), plutôt que laissés à l'attribution implicite
# de `adduser -S`/`addgroup -S` (le premier uid/gid système libre dans l'image de base) :
# docker-compose.yml (service `init-uploads-pdf`, hors périmètre de ce fichier) fait un
# `chown -R 100:101 /uploads` en DUR sur le volume des PDF de facture, sur la foi de ces mêmes
# valeurs vérifiées empiriquement contre l'image `node:22-alpine` actuelle (`docker run --rm
# <image> id dfa`). Sans cet épinglage, un changement de numérotation dans une future version de
# l'image de base (ex. un paquet ajouté avant `dfa` dans la chaîne de construction, ou un
# changement de distribution) romprait silencieusement cette hypothèse : l'API perdrait l'accès
# en écriture à son propre volume de PDF, avec un `EACCES`/`Permission denied` au démarrage — un
# symptôme qui ne pointe pas vers sa vraie cause. Avec l'épinglage, l'uid/gid de `dfa` restent
# 100/101 quelle que soit l'évolution de l'image de base, aussi longtemps que ces valeurs ne
# collisionnent pas avec un compte système déjà présent (vérifié à ce jour : aucun uid/gid 100 ou
# 101 n'existe dans `node:22-alpine` avant la création de `dfa`, voir /etc/passwd et /etc/group de
# l'image). Si ces valeurs devaient un jour changer ici, `docker-compose.yml` doit être
# ajusté en conséquence dans le MÊME changement.
RUN addgroup -g 101 -S dfa && adduser -S -u 100 -G dfa -h /repo -s /sbin/nologin dfa

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

# VERSION_APP / VERSION_APP_BRANCHE : le dossier .git n'existe PAS dans cette image (voir
# apps/api/src/config/version-app.ts, qui ne calcule ces deux valeurs QUE quand elles sont
# absentes de l'environnement — jamais le cas ici, ARG/ENV les fixent toujours). Valeurs
# calculées et injectées par `.github/workflows/publier-images.yml` (--build-arg) au moment de
# construire et publier l'image ; les défauts ci-dessous ne servent qu'à un `docker build` manuel
# hors CI (repli honnête, jamais un plantage de la validation zod au démarrage). `ENV` après `ARG`
# fige la valeur dans l'image : `docker-compose.yml` ne la répète pas (ni dans
# `environment:`, ni dans `.env.production`/`env_file:`), donc c'est bien cette valeur figée au
# build qui atteint le schéma zod de configuration au démarrage du conteneur.
ARG VERSION_APP=0.0.0-image
ENV VERSION_APP=${VERSION_APP}
ARG VERSION_APP_BRANCHE=inconnue
ENV VERSION_APP_BRANCHE=${VERSION_APP_BRANCHE}

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
