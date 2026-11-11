#!/bin/sh
# Restores the database from a dfa-*.sql.gz backup (not an .age file: decrypt it first).
#
#   docker compose stop api worker
#   docker compose exec -u dfa backup /scripts/restaurer.sh dfa-2026-11-10_023000.sql.gz
#   docker compose start api worker
#
# The dump is loaded into a NEW database first. Only when that succeeds does it replace the live
# database (renamed to dfa_avant_restauration_<time>, dropped by you when you are satisfied), so
# a damaged backup never destroys the current data.
set -eu

fichier="${1:?usage: restaurer.sh <backup file in ./backups>}"
case "$fichier" in /*) ;; *) fichier="/backups/$fichier" ;; esac
[ -r "$fichier" ] || { echo "restore: cannot read $fichier" >&2; exit 1; }
case "$fichier" in *.sql.gz) ;; *) echo "restore: expected a .sql.gz file (decrypt .age files first)" >&2; exit 1 ;; esac
gzip -t "$fichier"

PGPASSWORD="$(cat /secrets/postgres_password)"
export PGPASSWORD
base="${PGDATABASE:-dfa}"
nouvelle="${base}_restauration"
ancienne="${base}_avant_restauration_$(date +%Y%m%d%H%M%S)"
sql() { psql --host "${PGHOST:-postgres}" --username "${PGUSER:-dfa}" -v ON_ERROR_STOP=1 -q "$@"; }

sql -d postgres -c "DROP DATABASE IF EXISTS $nouvelle WITH (FORCE)" \
  -c "CREATE DATABASE $nouvelle ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"
# Same ownership and rights as the application sets up at start (see apps/api/src/db/amorcer-roles.ts).
sql -d "$nouvelle" -c "ALTER SCHEMA public OWNER TO dfa_migrator" \
  -c "REVOKE ALL ON SCHEMA public FROM PUBLIC" \
  -c "GRANT USAGE ON SCHEMA public TO dfa_migrator, dfa_app" \
  -c "GRANT CREATE ON DATABASE $nouvelle TO dfa_migrator"
gunzip -c "$fichier" | sql -d "$nouvelle"

sql -d postgres -c "ALTER DATABASE $base RENAME TO $ancienne" -c "ALTER DATABASE $nouvelle RENAME TO $base"
echo "restore: done. The previous database is kept as $ancienne:"
echo "restore:   docker compose exec postgres psql -U dfa -d postgres -c 'DROP DATABASE $ancienne WITH (FORCE)'"
