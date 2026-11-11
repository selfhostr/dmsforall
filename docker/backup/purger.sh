#!/bin/sh
# Deletes backups older than RETENTION_JOURS days (default 14), only files this service wrote.
set -eu
jours="${RETENTION_JOURS:-14}"
case "$jours" in '' | *[!0-9]*) echo "backup: RETENTION_JOURS must be a number" >&2; exit 1 ;; esac
find /backups -maxdepth 1 -type f \( -name 'dfa-*.sql.gz*' -o -name 'fichiers-*.tar.gz*' \) \
  -mtime +"$jours" -print -delete | sed 's/^/backup: purged /'
