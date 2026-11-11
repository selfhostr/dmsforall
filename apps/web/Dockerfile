# syntax=docker/dockerfile:1
#
# Web image (React + Vite single page app) served by nginx over HTTPS (self-signed certificate
# generated on first start, or your own in /certs). It also relays /api to the api container, so
# it is the only entry point of the installation. Multi-stage, built-in healthcheck, workers run as nginx.
#
# The build context is the repository root, not apps/web: pnpm needs the root lockfile, and Vite
# resolves @dfa/shared straight to its TypeScript sources.
#
#   docker build -f apps/web/Dockerfile -t ghcr.io/selfhostr/dmsforall-web:dev .

ARG NODE_IMAGE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
# nginx 1.31-alpine (mainline): the 1.27 base carried ~65 OS-level CVEs (musl, openssl, libexpat...).
ARG NGINX_IMAGE=nginx:1.31-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11

# --- base: Node + pnpm ---
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /repo

# --- deps ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @dfa/web...

# --- build: static bundle ---
FROM deps AS build
COPY packages/shared/src packages/shared/src
COPY tsconfig.base.json ./
COPY apps/web/index.html apps/web/index.html
# Vite copies public/ (favicon, apple-touch-icon) into dist/: without this line the image shipped
# without any of them.
COPY apps/web/public apps/web/public
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/components.json apps/web/components.json
COPY apps/web/src apps/web/src
# Vite inlines VITE_* variables at build time. The API is always served from the same origin
# as the web app, so a relative path is right for every deployment.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @dfa/web build

# --- runtime: nginx, HTTPS, non-root ---
FROM ${NGINX_IMAGE} AS runtime
# openssl generates the first-start certificate.
RUN apk add --no-cache openssl
RUN mkdir -p /var/cache/nginx/client_temp /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp /var/cache/nginx/uwsgi_temp /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx /etc/nginx

COPY --chown=nginx:nginx apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx apps/web/nginx-securite.conf /etc/nginx/securite.conf
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html
COPY --chmod=0755 docker/entrypoint-web.sh /usr/local/bin/dfa-web-entrypoint

# No USER line: the nginx master process stays root with minimal capabilities (docker-compose.yml
# drops all others), its workers run as nginx.
EXPOSE 8443

# Loopback-only probe listener (see nginx.conf), independent of the certificate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8081/healthz || exit 1

ENTRYPOINT ["dfa-web-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
