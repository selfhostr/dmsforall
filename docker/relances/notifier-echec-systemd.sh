#!/usr/bin/env bash
# =================================================================================================
# notifier-echec-systemd.sh — filet de DERNIER RECOURS, exécuté par `OnFailure=` de
# dfa-relances.service (voir dfa-relances-echec.service à côté). Ne duplique PAS la logique de
# declencher-relances.sh — c'est précisément ce qui doit survivre à un échec du script PRINCIPAL
# lui-même AVANT qu'il n'ait pu signaler quoi que ce soit lui-même (fichier d'identifiants
# introuvable, `curl`/`jq` absent après une mise à jour système, permissions cassées…).
#
# Reste minimal à dessein : un seul événement GlitchTip, best-effort (voir lib-glitchtip.sh). Si
# CECI échoue aussi (GlitchTip injoignable, `SENTRY_DSN` absent), le filet de tout dernier recours
# est chien-de-garde-relances.sh (§5 de docs/declenchement-relances-cron.md) : il détecte l'ABSENCE
# de statut frais, quelle qu'en soit la cause, sans dépendre d'aucun des deux scripts ci-dessus.
# =================================================================================================
set -uo pipefail

# shellcheck source=./lib-glitchtip.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-glitchtip.sh"

dfa_signaler_glitchtip \
  "dfa-relances.service en échec au niveau systemd, avant même le traitement d'un tenant — voir journalctl -u dfa-relances.service -n 100" \
  "error"

exit 0
