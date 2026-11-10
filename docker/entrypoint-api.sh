#!/bin/sh
# Entrypoint of the API image (API and worker).
#
# Nothing has to be prepared on the host. With the bundled docker-compose.yml, this script:
#   1. starts as root only to give the bind-mounted folders (/secrets, uploads) to the dfa user,
#      then drops its privileges;
#   2. generates the secrets the first time (app_password, migrator_password, secrets_key in
#      /secrets, a bind mount of ./data/secrets) and reads them back afterwards;
#   3. turns them into the settings the API reads (DATABASE_URL, DATABASE_URL_MIGRATION,
#      CLE_CHIFFREMENT_SECRETS, public URL, trusted proxy hops, outgoing email switch);
#   4. when DFA_MIGRER_AU_DEMARRAGE=true (the api service, never the worker): creates the two
#      restricted database roles if needed and applies the pending migrations, then starts. The
#      migration runner takes a database advisory lock, so only one process migrates at a time.
# An external PostgreSQL (DATABASE_URL already set) skips the generated database passwords.
set -eu

UPLOADS=/repo/apps/api/uploads

if [ "$(id -u)" = 0 ]; then
  mkdir -p /secrets "$UPLOADS"
  chown dfa:dfa /secrets
  chmod 0700 /secrets
  if [ "$(stat -c %u "$UPLOADS")" != "$(id -u dfa)" ]; then
    chown -R dfa:dfa "$UPLOADS"
  fi
  exec su-exec dfa:dfa "$0" "$@"
fi

mkdir -p "$UPLOADS/documents-pdf" "$UPLOADS/exports-resiliation" "$UPLOADS/photos-or" "$UPLOADS/reprise"

# --- secrets: created once, never overwritten ----------------------------------------------------
umask 077
gen_secret() {
  name="$1"
  if [ ! -s "/secrets/$name" ]; then
    if [ "$name" = secrets_key ]; then
      head -c 32 /dev/urandom | base64 > "/secrets/$name.tmp"
    else
      tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40 > "/secrets/$name.tmp"
    fi
    mv "/secrets/$name.tmp" "/secrets/$name"
    echo "dmsforall: generated secret $name in ./data/secrets (keep this folder safe, it is part of your backups)"
  fi
}

generated_db=false
if [ -z "${DATABASE_URL:-}" ]; then
  gen_secret app_password
  gen_secret migrator_password
  generated_db=true
fi
if [ -z "${CLE_CHIFFREMENT_SECRETS:-}" ]; then
  gen_secret secrets_key
  CLE_CHIFFREMENT_SECRETS="$(cat /secrets/secrets_key)"
  export CLE_CHIFFREMENT_SECRETS
fi

db_host="${DFA_DB_HOST:-postgres}"
db_port="${DFA_DB_PORT:-5432}"
db_name="${DFA_DB_NAME:-dfa}"
if [ "$generated_db" = true ]; then
  DATABASE_URL="postgresql://dfa_app:$(cat /secrets/app_password)@${db_host}:${db_port}/${db_name}"
  DATABASE_URL_MIGRATION="postgresql://dfa_migrator:$(cat /secrets/migrator_password)@${db_host}:${db_port}/${db_name}"
  export DATABASE_URL DATABASE_URL_MIGRATION
fi

# --- public address, cookies and proxy ------------------------------------------------------------
# DFA_PUBLIC_URL set: a reverse proxy with a real name sits in front (two proxy hops: it, then the
# web container) and the browser origin must be exactly that URL.
# Not set: direct access to https://<address>:<port>. One hop, and the browser origin is accepted
# when it matches the Host header of the request. The session cookie is always Secure.
if [ -n "${DFA_PUBLIC_URL:-}" ]; then
  base_url="${DFA_PUBLIC_URL%/}"
  : "${TRUST_PROXY_HOPS:=2}"
else
  base_url="https://localhost:${DFA_PORT:-8443}"
  : "${TRUST_PROXY_HOPS:=1}"
  ORIGINE_ACCEPTER_HOTE=true
  export ORIGINE_ACCEPTER_HOTE
fi
: "${API_URL_PUBLIQUE:=$base_url}"
: "${WEB_URL_PUBLIQUE:=$base_url}"
COOKIE_SECURE=true
export TRUST_PROXY_HOPS API_URL_PUBLIQUE WEB_URL_PUBLIQUE COOKIE_SECURE

if [ -n "${SMTP_HOTE:-}" ] && [ -z "${COURRIEL_ENVOI_REEL:-}" ]; then
  COURRIEL_ENVOI_REEL=true
  export COURRIEL_ENVOI_REEL
fi

# --- database roles and migrations (api service only) ---------------------------------------------
if [ "${DFA_MIGRER_AU_DEMARRAGE:-false}" = true ] && [ "$generated_db" = true ]; then
  DFA_AMORCAGE_URL="postgresql://dfa:$(cat /secrets/postgres_password)@${db_host}:${db_port}/${db_name}" \
  DFA_AMORCAGE_MDP_APP="$(cat /secrets/app_password)" \
  DFA_AMORCAGE_MDP_MIGRATOR="$(cat /secrets/migrator_password)" \
    node dist/db/amorcer-roles.js
fi
if [ "${DFA_MIGRER_AU_DEMARRAGE:-false}" = true ]; then
  node dist/db/migrer.js
fi

exec "$@"
