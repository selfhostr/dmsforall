#!/usr/bin/env bash
# =================================================================================================
# declencher-relances.sh — déclenchement périodique (systemd timer, voir docker/relances/*.timer)
# de POST /relances/facturation/planifier puis POST /relances/facturation/envoyer, POUR CHAQUE
# TENANT ACTIF. Implémentation exécutable de docs/declenchement-relances-cron.md (qui explique le
# POURQUOI de chaque choix ci-dessous — ce script exécute, il ne réexplique pas). GARDER LES DEUX
# EN SYNC si l'un des deux change.
#
# ------------------------------------------------------------------------------------------------
# POURQUOI UNE BOUCLE PAR TENANT, ET PAS UN SEUL APPEL GLOBAL
# ------------------------------------------------------------------------------------------------
# `ServiceContexteRequete.contexteTenant()` (apps/api/src/common/contexte/) résout le tenant
# EXCLUSIVEMENT depuis le principal authentifié de la requête — jamais depuis un paramètre. Les
# deux routes appelées ci-dessous ne traitent donc jamais qu'UN SEUL tenant par appel : celui du
# jeton présenté. Il n'existe et ne doit jamais exister de route « pour tous les tenants » — ce
# script fait la boucle que l'API ne fait pas, avec un jeton DISTINCT par tenant (voir §2 du
# document ci-dessus : ce jeton machine n'existe pas encore, ce script en présuppose la livraison).
#
# Un échec sur un tenant (jeton révoqué, connecteur NotificationSender en panne pour ce garage,
# timeout réseau) NE DOIT JAMAIS empêcher les autres tenants d'être traités — d'où l'absence de
# `set -e` global autour de la boucle principale : chaque échec est capturé, journalisé, compté,
# et la boucle continue. Le script ne sort en échec (code ≠ 0, qui fait échouer le service systemd
# et déclenche `OnFailure=`, voir le .service à côté) qu'À LA FIN, si au moins un tenant a échoué.
#
# Usage (systemd timer — jamais de secret en argument de commande) :
#   EnvironmentFile=/opt/dfa/.env.production
#   ExecStart=/opt/dfa/docker/relances/declencher-relances.sh
#
# Variables requises dans l'environnement du planificateur :
#   WEB_URL_PUBLIQUE        déjà présente dans .env.production (front et API partagent la même
#                            origine publique, voir docker-compose.yml) — RIEN de nouveau à y
#                            ajouter pour cette variable précise.
#   IDENTIFIANTS_FICHIER    chemin vers le fichier tenant→jeton (défaut ci-dessous), JAMAIS dans le
#                            dépôt git — voir identifiants-relances.env.example à côté de ce script
#                            pour le format exact et où le placer réellement sur le serveur.
# Variables optionnelles :
#   LIMITE_ITERATIONS       garde-fou anti-boucle-infinie sur `encoreATraiter` (défaut 20 — largement
#                            au-dessus de ce qu'un lot borné réaliste produit en un passage).
#
# Supervision : voir lib-glitchtip.sh, sourcé ci-dessous — `SENTRY_DSN` est DÉJÀ présent dans
# `.env.production` (l'application l'utilise déjà), rien de plus à provisionner ici (§5 du
# document).
# =================================================================================================
set -uo pipefail
# PAS de `-e` ici : voir le commentaire ci-dessus, la gestion d'erreur par tenant est EXPLICITE.

: "${WEB_URL_PUBLIQUE:?WEB_URL_PUBLIQUE manquant — voir .env.production}"
IDENTIFIANTS_FICHIER="${IDENTIFIANTS_FICHIER:-/opt/dfa/secrets/identifiants-relances.env}"
LIMITE_ITERATIONS="${LIMITE_ITERATIONS:-20}"

# shellcheck source=./lib-glitchtip.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-glitchtip.sh"

if [ ! -f "$IDENTIFIANTS_FICHIER" ]; then
  echo "ERREUR : fichier d'identifiants introuvable ($IDENTIFIANTS_FICHIER)." >&2
  echo "Voir docker/relances/identifiants-relances.env.example pour le format attendu." >&2
  exit 1
fi

# Hairpin NAT : sur beaucoup d'hébergeurs cloud, une requête émise PAR le serveur vers son PROPRE
# nom de domaine public échoue ou boucle de façon inattendue (le trafic sortant ne revient pas par
# la même route qu'un client externe). `--resolve` force curl à joindre Caddy en LOOPBACK tout en
# présentant le VRAI Host/SNI — Caddy route donc exactement comme pour un client public, sans
# dépendre d'un aller-retour Internet ni de la résolution DNS publique pour un appel purement
# local. Voir docs/declenchement-relances-cron.md §1 pour ce piège documenté en détail.
DOMAINE="$(echo "$WEB_URL_PUBLIQUE" | sed -E 's#^https?://##; s#/.*##; s#:.*##')"
PORT="$([ "${WEB_URL_PUBLIQUE#https}" != "$WEB_URL_PUBLIQUE" ] && echo 443 || echo 80)"
CURL_RESOLVE=(--resolve "${DOMAINE}:${PORT}:127.0.0.1")

# Fichier de statut vérifiable — même doctrine que docker/postgres/sauvegarde/sauvegarde-postgres.sh
# (un cron qui échoue en silence équivaut à ne pas avoir de relances du tout, voir §5).
RACINE_DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATUT_FICHIER="${STATUT_FICHIER:-${RACINE_DEPOT}/.dernier-statut-relances}"

TENANTS_OK=0
TENANTS_ECHEC=0
RESUME=()

# --- Un appel POST, avec pagination bornée sur `encoreATraiter` --------------------------------
# Rend 0 et laisse le compteur d'itérations dans $ITERATIONS_UTILISEES si tout s'est bien passé
# (y compris zéro lignes à traiter), 1 sinon. N'utilise JAMAIS `set -e` implicite : chaque appel
# curl est vérifié explicitement pour ne jamais tuer le script entier sur un tenant en échec.
appeler_route_paginee() {
  local tenant="$1" jeton="$2" route="$3"
  local iteration=0
  local encore_a_traiter="true"

  while [ "$encore_a_traiter" = "true" ]; do
    iteration=$((iteration + 1))
    if [ "$iteration" -gt "$LIMITE_ITERATIONS" ]; then
      echo "  [$tenant] $route : LIMITE_ITERATIONS ($LIMITE_ITERATIONS) atteinte — arrêt de ce tenant, à investiguer." >&2
      return 1
    fi

    # PAS d'en-tête `Origin` ici, volontairement : ce script n'en fabrique pas un pour imiter un
    # navigateur (voir docs/declenchement-relances-cron.md §2 — ce serait exactement le genre de
    # contournement qu'il ne faut jamais construire). Conséquence assumée et documentée : TEL QUEL,
    # cet appel reçoit AUJOURD'HUI `403 AUTH_ORIGINE_REFUSEE` (`GardeSession.verifierOrigine`,
    # apps/api/src/auth/garde-session.ts, exige un `Origin` sur TOUTE méthode mutante, sans
    # exception actuelle pour un appelant non-navigateur). Ce script ne devient réellement
    # exécutable qu'après le préalable applicatif du §2 : un chemin d'authentification par jeton
    # machine (`Authorization: Bearer`) explicitement DISPENSÉ de cette vérification, parce qu'un
    # appel sans cookie n'a structurellement rien à craindre du CSRF que la vérification Origin
    # existe pour bloquer.
    local reponse code corps
    reponse="$(curl -sS "${CURL_RESOLVE[@]}" -o /tmp/relance-reponse-$$.json -w '%{http_code}' \
      -X POST "${WEB_URL_PUBLIQUE}/api/v1/relances/facturation/${route}" \
      -H "Authorization: Bearer ${jeton}" \
      -H 'Content-Type: application/json' \
      --max-time 30)" || { echo "  [$tenant] $route : curl injoignable." >&2; rm -f /tmp/relance-reponse-$$.json; return 1; }
    code="$reponse"
    corps="$(cat /tmp/relance-reponse-$$.json 2>/dev/null || true)"
    rm -f /tmp/relance-reponse-$$.json

    if [ "$code" != "200" ]; then
      echo "  [$tenant] $route : HTTP $code — $corps" >&2
      return 1
    fi

    encore_a_traiter="$(echo "$corps" | jq -r '.encoreATraiter // false')"
    echo "  [$tenant] $route (itération $iteration) : $corps"
  done
  return 0
}

# --- Boucle sur chaque tenant --------------------------------------------------------------
# Format du fichier d'identifiants : une ligne par tenant, `slug:jeton` (voir
# identifiants-relances.env.example) — lu ligne à ligne, PAS `source`é : ce fichier porte des
# secrets, pas des instructions shell à exécuter, même s'il ne contenait aujourd'hui que des
# affectations inoffensives.
while IFS=':' read -r tenant jeton || [ -n "$tenant" ]; do
  [ -z "$tenant" ] && continue
  case "$tenant" in \#*) continue ;; esac

  echo "→ Tenant : $tenant"
  if appeler_route_paginee "$tenant" "$jeton" "planifier" \
    && appeler_route_paginee "$tenant" "$jeton" "envoyer"; then
    TENANTS_OK=$((TENANTS_OK + 1))
    RESUME+=("$tenant:ok")
  else
    TENANTS_ECHEC=$((TENANTS_ECHEC + 1))
    RESUME+=("$tenant:echec")
    # Signalé PAR TENANT, pas seulement en résumé global : GlitchTip regroupe les événements de
    # message identique dans un même ISSUE (comptage d'occurrences), donc dix tenants en échec le
    # même jour ne noient pas la boîte de réception — voir §5 du document. Un échec ponctuel
    # (connecteur du garage X en panne) reste distinguable d'un échec systémique (tous les tenants).
    dfa_signaler_glitchtip "relances : tenant ${tenant} en échec (planifier/envoyer) — voir journalctl -u dfa-relances.service" "error"
  fi
done < "$IDENTIFIANTS_FICHIER"

HORODATAGE="$(date -Iseconds)"
if [ "$TENANTS_ECHEC" -eq 0 ]; then
  printf 'OK %s tenants=%d %s\n' "$HORODATAGE" "$TENANTS_OK" "${RESUME[*]:-}" > "$STATUT_FICHIER"
  echo "declencher-relances.sh : $TENANTS_OK tenant(s) traité(s) sans échec ($HORODATAGE)."
  exit 0
else
  printf 'ECHEC_PARTIEL %s ok=%d echec=%d %s\n' "$HORODATAGE" "$TENANTS_OK" "$TENANTS_ECHEC" "${RESUME[*]}" > "$STATUT_FICHIER"
  echo "declencher-relances.sh : $TENANTS_ECHEC tenant(s) en échec sur $((TENANTS_OK + TENANTS_ECHEC)) ($HORODATAGE)." >&2
  # Résumé global EN PLUS des signaux par tenant ci-dessus : utile pour voir d'un coup d'œil dans
  # GlitchTip qu'un passage était partiellement en échec, sans avoir à recompter les issues.
  dfa_signaler_glitchtip "relances : passage en échec partiel — $TENANTS_ECHEC/$((TENANTS_OK + TENANTS_ECHEC)) tenant(s)" "error"
  exit 1
fi
