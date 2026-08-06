#!/usr/bin/env bash
# =================================================================================================
# chien-de-garde-relances.sh — détecte le SILENCE TOTAL : dfa-relances.timer qui ne déclenche plus
# RIEN DU TOUT (serveur éteint, timer désactivé par erreur lors d'une maintenance, panne systemd,
# `docker.service` qui ne redémarre jamais donc `After=` bloque indéfiniment). C'est le seul cas
# qu'AUCUN des deux autres mécanismes ne peut couvrir : declencher-relances.sh et
# notifier-echec-systemd.sh signalent tous deux un ÉCHEC CONSTATÉ — un script qui ne s'exécute
# jamais ne constate rien, ne signale rien. Voir docs/declenchement-relances-cron.md §5, qui
# qualifie ce cas de pire scénario : « des clients qui ne sont plus relancés sans que personne le
# voie ».
#
# Mécanisme délibérément indépendant du reste : il ne lit QUE l'horodatage du fichier de statut
# écrit par declencher-relances.sh (`STATUT_FICHIER`), jamais son contenu métier ni la base — une
# panne qui casserait aussi CE script ne doit pas dépendre du même code que ce qu'il surveille.
#
# Planifié séparément (dfa-relances-chien-de-garde.timer, marge de sécurité après l'heure
# attendue de dfa-relances.timer — voir ce fichier) — JAMAIS depuis `OnFailure=` d'une unité qui
# pourrait elle-même ne jamais démarrer.
# =================================================================================================
set -uo pipefail

RACINE_DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATUT_FICHIER="${STATUT_FICHIER:-${RACINE_DEPOT}/.dernier-statut-relances}"
# 6h de marge après l'heure attendue de dfa-relances.timer (07:30 + délai aléatoire + durée des
# lots) : largement suffisant pour absorber une exécution lente un jour de gros volume, sans
# laisser passer un jour entier de silence avant d'alerter.
LIMITE_SECONDES="${LIMITE_SECONDES:-21600}"

# shellcheck source=./lib-glitchtip.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-glitchtip.sh"

if [ ! -f "$STATUT_FICHIER" ]; then
  dfa_signaler_glitchtip \
    "relances : aucun statut n'a jamais été écrit ($STATUT_FICHIER absent) — dfa-relances.timer n'a peut-être jamais tourné" \
    "error"
  exit 0
fi

MAINTENANT=$(date +%s)
MODIFIE_LE=$(date -r "$STATUT_FICHIER" +%s)
AGE_SECONDES=$((MAINTENANT - MODIFIE_LE))

if [ "$AGE_SECONDES" -gt "$LIMITE_SECONDES" ]; then
  AGE_HEURES=$((AGE_SECONDES / 3600))
  dfa_signaler_glitchtip \
    "relances : dernier statut vieux de ${AGE_HEURES}h ($STATUT_FICHIER) — dfa-relances.timer semble silencieux, vérifier 'systemctl list-timers dfa-relances.timer'" \
    "error"
fi

exit 0
