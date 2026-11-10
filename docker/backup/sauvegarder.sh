#!/bin/sh
# One backup: dfa-AAAA-MM-JJ_HHMMSS.sql.gz (pg_dump of the whole database) and
# fichiers-AAAA-MM-JJ_HHMMSS.tar.gz (the uploaded files) in /backups. Written under a temporary
# name then renamed, so a half-written file is never taken for a backup.
# Run it by hand:  docker compose exec -u dfa backup /scripts/sauvegarder.sh
# With AGE_CLE_PUBLIQUE set (an age public key), both files are encrypted and end in .age.
set -eu

DEST=/backups
horodatage=$(date +%Y-%m-%d_%H%M%S)
PGPASSWORD="$(cat /secrets/postgres_password)"
export PGPASSWORD

finir() { # $1 = temporary file, $2 = final name
  mv "$1" "$2"
  echo "backup: $2 ($(wc -c < "$2") bytes)"
}

chiffrer() { # stdin -> stdout
  if [ -n "${AGE_CLE_PUBLIQUE:-}" ]; then age -r "$AGE_CLE_PUBLIQUE"; else cat; fi
}
ext=""
[ -n "${AGE_CLE_PUBLIQUE:-}" ] && ext=".age"

base="$DEST/dfa-$horodatage.sql.gz$ext"
# Plain SQL, owners kept (roles dfa_migrator / dfa_app). restaurer.sh loads it into a fresh database.
pg_dump --host "${PGHOST:-postgres}" --username "${PGUSER:-dfa}" --dbname "${PGDATABASE:-dfa}" \
  | gzip -9 | chiffrer > "$base.tmp"
finir "$base.tmp" "$base"

fichiers="$DEST/fichiers-$horodatage.tar.gz$ext"
tar -C /fichiers -czf - . | chiffrer > "$fichiers.tmp"
finir "$fichiers.tmp" "$fichiers"
