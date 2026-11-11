#!/bin/sh
# PID 1 of the backup service: sleeps until HEURE_SAUVEGARDE (HH:MM, local time of the container,
# TZ), runs sauvegarder.sh, then purger.sh, and starts over. A failed backup is logged and tried
# again the next day; the container keeps running so that `docker compose ps` stays meaningful.
set -u

HEURE="${HEURE_SAUVEGARDE:-02:30}"
case "$HEURE" in
  [0-1][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;;
  *) echo "backup: HEURE_SAUVEGARDE must look like 02:30 (got '$HEURE')" >&2; exit 1 ;;
esac
# "08" is not a valid number for shell arithmetic: strip the leading zero.
num() { echo "$1" | sed 's/^0*\(.\)/\1/'; }
cible=$(( $(num "${HEURE%:*}") * 3600 + $(num "${HEURE#*:}") * 60 ))

echo "backup: scheduled every day at $HEURE ($TZ), kept ${RETENTION_JOURS:-14} days, in ./backups"
while true; do
  maintenant=$(( $(num "$(date +%H)") * 3600 + $(num "$(date +%M)") * 60 + $(num "$(date +%S)") ))
  attente=$(( (cible - maintenant + 86400) % 86400 ))
  [ "$attente" -eq 0 ] && attente=86400
  sleep "$attente"
  /scripts/sauvegarder.sh || echo "backup: FAILED, will retry tomorrow" >&2
  /scripts/purger.sh || true
done
