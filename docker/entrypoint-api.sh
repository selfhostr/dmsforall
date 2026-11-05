#!/bin/sh
# Entrypoint of the API image (API, worker and migration jobs).
#
# With the bundled docker-compose.yml, the database passwords are generated on first start and
# stored in a volume mounted at /secrets (files app_password and migrator_password). This script
# builds DATABASE_URL and DATABASE_URL_MIGRATION from them. If DATABASE_URL is already set (an
# external PostgreSQL, a custom setup), nothing is touched.
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -r /secrets/app_password ]; then
  db_host="${DFA_DB_HOST:-postgres}"
  db_port="${DFA_DB_PORT:-5432}"
  db_name="${DFA_DB_NAME:-dfa}"
  DATABASE_URL="postgresql://dfa_app:$(cat /secrets/app_password)@${db_host}:${db_port}/${db_name}"
  DATABASE_URL_MIGRATION="postgresql://dfa_migrator:$(cat /secrets/migrator_password)@${db_host}:${db_port}/${db_name}"
  export DATABASE_URL DATABASE_URL_MIGRATION
fi

exec "$@"
