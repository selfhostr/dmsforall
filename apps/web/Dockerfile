# syntax=docker/dockerfile:1
#
# Image de production du front DFA (React + Vite, SPA). Build multi-étapes : compile en
# bundle statique, sert le résultat par nginx. Utilisateur non-root, healthcheck intégré.
#
# CONTEXTE DE BUILD = RACINE DU MONOREPO, PAS apps/web. Comme pour apps/api/Dockerfile (même
# raisonnement, voir son commentaire de tête), pnpm workspaces exige le lockfile et
# pnpm-workspace.yaml de la racine. Mais il y a ici une deuxième raison, propre au front, plus
# stricte : `@dfa/shared` est compilé en CommonJS pour l'API, ce que Rollup ne sait pas
# tree-shaker proprement — apps/web/vite.config.ts résout donc l'import `@dfa/shared` par un
# ALIAS directement vers packages/shared/src/index.ts (les SOURCES TypeScript, pas dist/).
# Un contexte de build limité à apps/web ne verrait tout simplement pas packages/shared/src :
# le build Vite échouerait à résoudre l'import.
#
# Construire depuis la racine :
#   docker build -f apps/web/Dockerfile -t dfa-web:<tag> .
# (docker-compose.yml : `build.context: .`)
#
# Comme pour l'API, ce Dockerfile ne fait jamais `COPY . .` : chaque étape copie nommément ce
# dont elle a besoin. apps/web/.dockerignore reste un filet de défense en profondeur, pas le
# mécanisme principal d'exclusion des secrets.

ARG NODE_VERSION=22-alpine

# --- Étape de base : Node + pnpm (via corepack) -----------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /repo

# --- Étape deps : installation complète, limitée au front + ses dépendances internes ---------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dfa/web...

# --- Étape build : bundle statique (vite build) -----------------------------------------------
FROM deps AS build
# `@dfa/shared` est consommé depuis ses SOURCES via l'alias Vite (voir commentaire de tête) :
# copier son package.json (déjà fait par l'étape deps) ne suffit pas, il faut le code lui-même.
COPY packages/shared/src packages/shared/src
COPY apps/web/index.html apps/web/index.html
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/components.json apps/web/components.json
COPY apps/web/src apps/web/src
# Vite inline les variables `VITE_*` dans le bundle AU BUILD, pas au démarrage du conteneur
# (contrairement à la config de l'API, validée au runtime) — voir docs/deploiement-production.md
# pour l'implication sur les rollbacks/redeploiements. Valeur alignée sur le `.env.example` de la
# racine du dépôt : chemin relatif, le front est toujours servi derrière le même reverse proxy
# que l'API, en dev comme en prod, donc cette valeur ne varie normalement jamais entre
# environnements.
#
# Aucun `.env` n'est copié dans ce contexte de build : `apps/web/vite.config.ts` lit VITE_API_URL
# via `loadEnv`, qui retombe sur `process.env` en l'absence de fichier — l'`ENV` Docker
# ci-dessous suffit donc à satisfaire le garde-fou qui fait échouer `vite build` si la variable
# est absente (vérifié : build sans .env + VITE_API_URL en variable de process = succès).
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @dfa/web build

# --- Étape finale : nginx minimal, non-root ----------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# L'image nginx:alpine officielle définit déjà un utilisateur/groupe système `nginx` (utilisé
# habituellement pour les workers, pendant que le master tourne en root) — on le réutilise pour
# TOUT le processus (master + workers), pas seulement les workers, afin que le conteneur ne
# tourne jamais en root, pas même un instant.
RUN mkdir -p /var/cache/nginx/client_temp /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp /var/cache/nginx/uwsgi_temp /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx /etc/nginx

COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html

USER nginx

# Port non privilégié — voir nginx.conf. Jamais publié directement sur l'hôte en prod, le
# reverse proxy est le seul point d'entrée public (voir docker-compose.yml).
EXPOSE 8080

# `wget` (busybox) est présent par défaut dans l'image nginx:alpine — pas de paquet
# supplémentaire à installer pour la sonde de vie.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

# Forme exec, nginx devient PID 1 directement (signaux reçus sans intermédiaire) ; `daemon off`
# est indispensable dans un conteneur (sinon nginx forke et le conteneur croit le process
# terminé immédiatement).
CMD ["nginx", "-g", "daemon off;"]
