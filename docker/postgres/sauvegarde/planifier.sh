#!/usr/bin/env bash
# =================================================================================================
# planifier.sh — processus PID 1 du service `backup` (docker-compose.yml). Boucle simple qui
# déclenche sauvegarder.sh une fois par jour à HEURE_SAUVEGARDE (heure locale du conteneur, fixée
# par TZ=Europe/Zurich dans le Dockerfile), sans dépendre d'un cron/systemd du serveur — cohérent
# avec le choix « TOUT en conteneurs » du reste de docker-compose.yml.
#
# Pourquoi une boucle plutôt qu'un cron interne (busybox crond) : un daemon cron démarré comme
# PID 1 lance ses tâches dans un environnement potentiellement APPAUVRI (l'héritage des variables
# d'environnement du conteneur par les tâches planifiées varie selon l'implémentation) — piège déjà
# rencontré côté hôte pour ce projet (voir l'ancien commentaire encore présent en historique Git
# sur sauvegarde-postgres.sh : « un cron n'hérite d'aucun profil shell »). Cette boucle, elle, EST
# le process 1 : sauvegarder.sh est lancé comme un enfant Bash ordinaire, qui hérite de
# l'environnement du conteneur exactement comme n'importe quel programme lancé à la main —
# aucune question d'héritage à se poser.
#
# Pourquoi un sondage toutes les POLL_SECONDES plutôt qu'un unique `sleep` calculé une fois :
# un `sleep` unique de plusieurs heures, calculé au début de l'attente, ne se réajuste pas si
# l'horloge du conteneur change entre-temps (dérive NTP, changement d'heure été/hiver Europe/
# Zurich) — la fenêtre de déclenchement pourrait glisser d'une heure lors des transitions. En
# recalculant l'heure courante à chaque réveil, ce script reste correct même à travers un
# changement d'heure, au prix d'un réveil superflu toutes les POLL_SECONDES (coût négligeable).
# =================================================================================================
set -euo pipefail

HEURE_SAUVEGARDE="${HEURE_SAUVEGARDE:-03:15}"
POLL_SECONDES="${POLL_SECONDES:-30}"
FICHIER_VIVANT="${FICHIER_VIVANT:-/tmp/planifier-vivant}"

if ! [[ "$HEURE_SAUVEGARDE" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "HEURE_SAUVEGARDE invalide (attendu HH:MM, reçu '${HEURE_SAUVEGARDE}')" >&2
  exit 1
fi

minutes_depuis_minuit() {
  local hh="${1%%:*}" mm="${1##*:}"
  echo $((10#$hh * 60 + 10#$mm))
}

CIBLE_MINUTES="$(minutes_depuis_minuit "$HEURE_SAUVEGARDE")"
dernier_jour_declenche=""

echo "$(date -Iseconds) planifier.sh démarré — sauvegarde quotidienne prévue à ${HEURE_SAUVEGARDE} (${TZ:-heure locale du conteneur})"

while true; do
  date -Iseconds >"$FICHIER_VIVANT"

  aujourdhui="$(date +%F)"
  maintenant_minutes="$(minutes_depuis_minuit "$(date +%H:%M)")"

  if [ "$aujourdhui" != "$dernier_jour_declenche" ] && [ "$maintenant_minutes" -ge "$CIBLE_MINUTES" ]; then
    dernier_jour_declenche="$aujourdhui"
    echo "$(date -Iseconds) déclenchement de la sauvegarde du ${aujourdhui}"
    /scripts/sauvegarder.sh || echo "$(date -Iseconds) sauvegarder.sh a échoué (code $?) — voir /sauvegardes/journal.log"
  fi

  sleep "$POLL_SECONDES"
done
