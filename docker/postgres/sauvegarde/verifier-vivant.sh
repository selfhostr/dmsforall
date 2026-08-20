#!/usr/bin/env bash
# =================================================================================================
# verifier-vivant.sh — HEALTHCHECK du service `backup` (docker-compose.yml). Un service qui
# ne se déclenche qu'une fois par nuit ne peut pas prouver sa santé en observant un travail en
# cours (il n'y en a presque jamais) — on observe donc le battement de cœur que planifier.sh écrit
# à chaque tour de sa boucle de sondage (toutes les POLL_SECONDES, 30s par défaut) : si ce fichier
# n'a pas été rafraîchi récemment, la boucle est bloquée ou morte, peu importe la cause exacte.
#
# Ce healthcheck NE prouve PAS qu'une sauvegarde a réussi cette nuit — seulement que le
# planificateur est vivant. La preuve qu'une nuit a réussi ou échoué est dans
# /sauvegardes/dernier-statut.txt et /sauvegardes/journal.log (voir sauvegarder.sh), volontairement
# séparée : un healthcheck Docker sert à décider si le conteneur doit être redémarré, pas à
# remonter une alerte métier — mélanger les deux ferait redémarrer le conteneur en boucle sur un
# échec de sauvegarde qu'un redémarrage ne peut de toute façon pas corriger.
# =================================================================================================
set -euo pipefail

FICHIER_VIVANT="${FICHIER_VIVANT:-/tmp/planifier-vivant}"
SEUIL_SECONDES="${SEUIL_SECONDES:-90}"

if [ ! -f "$FICHIER_VIVANT" ]; then
  echo "absent : $FICHIER_VIVANT" >&2
  exit 1
fi

dernier_epoch="$(date -d "$(cat "$FICHIER_VIVANT")" +%s)"
maintenant_epoch="$(date +%s)"
ecart=$((maintenant_epoch - dernier_epoch))

if [ "$ecart" -gt "$SEUIL_SECONDES" ]; then
  echo "planificateur silencieux depuis ${ecart}s (seuil ${SEUIL_SECONDES}s)" >&2
  exit 1
fi

exit 0
