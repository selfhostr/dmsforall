#!/usr/bin/env bash
# =================================================================================================
# restaurer.sh: restore an encrypted backup (dfa_<timestamp>.dump.age, made by sauvegarder.sh, the
# older dfa_prod_<timestamp>.dump.age name works too) into a database of the running PostgreSQL
# container of docker-compose.yml.
#
# Run it from a clone of the repository, on the machine that runs the stack:
#
#   docker compose stop api worker
#   AGE_CLE_PRIVEE_FICHIER=/path/to/age.key \
#     docker/postgres/sauvegarde/restaurer.sh /path/to/dfa_20260101-031500.dump.age dfa --confirmer
#   docker compose up -d
#
# Typical disaster recovery: start a fresh stack (`docker compose up -d postgres`), restore into
# the database `dfa`, then start everything. The database passwords of the new stack are used,
# the roles are created by the new postgres container, so no role dump is needed.
#
# Safety:
#   - the target database must not exist, or --confirmer AND a typed confirmation are needed;
#   - decryption is streamed into pg_restore, no clear text file is written;
#   - the age private key is brought for the occasion: delete it from the server afterwards.
#
# Variable: AGE_CLE_PRIVEE_FICHIER, path to the age private key. Needs `age` and `docker` on the
# host. COMPOSE_ARGS adds options to `docker compose` (for example "-p myproject").
# =================================================================================================
set -euo pipefail

FICHIER="${1:-}"
BASE_CIBLE="${2:-}"
CONFIRMER=0
if [ "${3:-}" = "--confirmer" ]; then
  CONFIRMER=1
fi

if [ -z "$FICHIER" ] || [ -z "$BASE_CIBLE" ]; then
  cat >&2 <<'USAGE'
Usage: docker/postgres/sauvegarde/restaurer.sh <file.dump.age> <target-database> [--confirmer]

  <file.dump.age>      backup to restore (see the dfa_postgres_backups volume, or an off-site copy).
  <target-database>    database to create (use "dfa" to replace the one the API uses).
  --confirmer          needed, with a typed confirmation, when the target database already exists.

Variable required: AGE_CLE_PRIVEE_FICHIER (path to the age private key).
USAGE
  exit 1
fi

if [ ! -r "$FICHIER" ]; then
  echo "Error: backup file not found or unreadable: ${FICHIER}" >&2
  exit 1
fi

if ! [[ "$BASE_CIBLE" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "Error: invalid database name '${BASE_CIBLE}' (lower case letters, digits and _ only)." >&2
  exit 1
fi

: "${AGE_CLE_PRIVEE_FICHIER:?AGE_CLE_PRIVEE_FICHIER is missing: path to the age private key}"
if [ ! -r "$AGE_CLE_PRIVEE_FICHIER" ]; then
  echo "Error: age private key not found or unreadable: ${AGE_CLE_PRIVEE_FICHIER}" >&2
  exit 1
fi

RACINE_DEPOT="${RACINE_DEPOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
# shellcheck disable=SC2206
COMPOSE=(docker compose -f "${RACINE_DEPOT}/docker-compose.yml" ${COMPOSE_ARGS:-})

# Inside the container the superuser connects through the local socket (trust), the migrator
# role over TCP with the generated password stored in /secrets.
psql_superviseur() {
  "${COMPOSE[@]}" exec -T postgres psql -U dfa -d postgres -v ON_ERROR_STOP=1 -tA "$@" </dev/null
}

echo "-> [1/5] Checking the target database '${BASE_CIBLE}'..."
existe="$(psql_superviseur -c "select 1 from pg_database where datname = '${BASE_CIBLE}';")"

if [ "$existe" = "1" ]; then
  if [ "$CONFIRMER" -ne 1 ]; then
    echo "REFUSED: database '${BASE_CIBLE}' exists. Use --confirmer to replace it (its data is lost)." >&2
    exit 1
  fi
  echo "WARNING: database '${BASE_CIBLE}' will be DROPPED and recreated from the backup." >&2
  read -r -p "Type the database name to confirm (${BASE_CIBLE}): " saisie
  if [ "$saisie" != "$BASE_CIBLE" ]; then
    echo "Different input, nothing was touched." >&2
    exit 1
  fi
  echo "-> [2/5] Dropping '${BASE_CIBLE}'..."
  psql_superviseur -c "drop database \"${BASE_CIBLE}\" with (force);" >/dev/null
else
  echo "-> [2/5] '${BASE_CIBLE}' does not exist yet, creating it."
fi

echo "-> [3/5] Creating '${BASE_CIBLE}' (owner dfa_migrator)..."
psql_superviseur -c "create database \"${BASE_CIBLE}\" owner dfa_migrator;" >/dev/null

echo "-> [4/5] Decrypting and restoring (streamed, may take minutes)..."
age -d -i "$AGE_CLE_PRIVEE_FICHIER" "$FICHIER" \
  | "${COMPOSE[@]}" exec -T postgres sh -c \
    "PGPASSWORD=\"\$(cat /secrets/migrator_password)\" pg_restore -h 127.0.0.1 -U dfa_migrator -d '${BASE_CIBLE}'"

echo "-> [5/5] Quick checks on '${BASE_CIBLE}':"
echo "  tables in schema public:"
"${COMPOSE[@]}" exec -T postgres psql -U dfa -d "$BASE_CIBLE" -tA \
  -c "select count(*) from information_schema.tables where table_schema = 'public';"
echo "  garages (tenants):"
"${COMPOSE[@]}" exec -T postgres psql -U dfa -d "$BASE_CIBLE" -tA -c "select count(*) from tenant;"

echo ""
echo "OK. Database '${BASE_CIBLE}' restored from $(basename "$FICHIER")."
if [ "$BASE_CIBLE" != "dfa" ]; then
  echo "The API does not use it: it reads the database 'dfa'."
fi
echo "Delete ${AGE_CLE_PRIVEE_FICHIER} from this server now: the private key must not stay here."
