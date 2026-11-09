#!/bin/sh
# Entrypoint of the API image (API, worker and migration jobs).
#
# With the bundled docker-compose.yml, the database passwords and the encryption key are
# generated on first start and stored in a volume mounted at /secrets (files app_password,
# migrator_password and secrets_key). This script turns them into the settings the API reads, so
# nobody has to type them:
#   - DATABASE_URL and DATABASE_URL_MIGRATION, unless DATABASE_URL is already set (an external
#     PostgreSQL, a custom setup);
#   - CLE_CHIFFREMENT_SECRETS, unless already set;
#   - COURRIEL_ENVOI_REEL=true as soon as an SMTP host is set, unless already set.
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -r /secrets/app_password ]; then
  db_host="${DFA_DB_HOST:-postgres}"
  db_port="${DFA_DB_PORT:-5432}"
  db_name="${DFA_DB_NAME:-dfa}"
  DATABASE_URL="postgresql://dfa_app:$(cat /secrets/app_password)@${db_host}:${db_port}/${db_name}"
  DATABASE_URL_MIGRATION="postgresql://dfa_migrator:$(cat /secrets/migrator_password)@${db_host}:${db_port}/${db_name}"
  export DATABASE_URL DATABASE_URL_MIGRATION
fi

if [ -z "${CLE_CHIFFREMENT_SECRETS:-}" ] && [ -r /secrets/secrets_key ]; then
  CLE_CHIFFREMENT_SECRETS="$(cat /secrets/secrets_key)"
  export CLE_CHIFFREMENT_SECRETS
fi

if [ -n "${SMTP_HOTE:-}" ] && [ -z "${COURRIEL_ENVOI_REEL:-}" ]; then
  COURRIEL_ENVOI_REEL=true
  export COURRIEL_ENVOI_REEL
fi

exec "$@"
