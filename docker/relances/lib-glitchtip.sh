#!/usr/bin/env bash
# =================================================================================================
# lib-glitchtip.sh — un seul point d'entrée, `dfa_signaler_glitchtip`, pour faire remonter un
# événement dans GlitchTip (auto-hébergé, Suisse — voir docs/sentry-auto-heberge.md) DEPUIS UN
# SCRIPT SHELL, sans SDK. Sourcé par declencher-relances.sh, notifier-echec-systemd.sh et
# chien-de-garde-relances.sh (voir docs/declenchement-relances-cron.md §5) — jamais dupliqué.
#
# ------------------------------------------------------------------------------------------------
# POURQUOI PAS UN SERVICE DE "HEARTBEAT" TIERS (UptimeRobot, Healthchecks.io...)
# ------------------------------------------------------------------------------------------------
# GlitchTip est DÉJÀ déployé, auto-hébergé en Suisse (nLPD) — `SENTRY_DSN` existe déjà dans
# `.env.production`, chargé par les unités systemd de ce répertoire (`EnvironmentFile=`). Poster un
# événement directement dedans, avec l'API "Store" historique de Sentry (protocole que GlitchTip
# réimplémente à l'identique — voir docs/sentry-auto-heberge.md §3), n'ajoute AUCUNE dépendance,
# AUCUN nouveau compte, AUCUN nouveau secret à protéger : la même boîte de réception que les
# erreurs applicatives, déjà surveillée par @laupernoe. Un tiers hors Suisse (la plupart des offres
# gratuites de heartbeat) aurait en plus posé une question nLPD pour une méta-donnée aussi anodine
# semble-t-il ("le job de relances a tourné") — pas la peine d'ouvrir ce débat quand l'alternative
# gratuite et déjà conforme existe.
#
# Limite assumée : cette fonction ne peut signaler qu'un échec qu'elle CONSTATE. Le silence total
# (le script ne tourne plus DU TOUT) est un cas différent, couvert par chien-de-garde-relances.sh
# — voir §5 du document.
# =================================================================================================

# dfa_signaler_glitchtip <message> [niveau=error]
# Best-effort STRICT : ne fait jamais échouer l'appelant (`return 0` sur toute erreur), un problème
# de supervision ne doit jamais devenir un problème de production. Écrit sur stderr si l'envoi
# échoue ou si SENTRY_DSN est absent, pour que `journalctl -u <unité>` garde une trace même quand
# GlitchTip ne reçoit rien.
dfa_signaler_glitchtip() {
  local message="${1:?dfa_signaler_glitchtip: message manquant}"
  local niveau="${2:-error}"

  if [ -z "${SENTRY_DSN:-}" ]; then
    echo "  (GlitchTip : SENTRY_DSN absent de l'environnement — signal perdu : $message)" >&2
    return 0
  fi

  # DSN classique Sentry/GlitchTip : schema://CLE@HOTE[:PORT]/PROJET — voir docs/sentry-auto-
  # heberge.md pour la forme exacte utilisée par ce déploiement. Découpage en bash pur (pas de
  # dépendance à `jq`/`python` pour un simple parsing d'URL).
  local sans_schema="${SENTRY_DSN#*://}"
  local cle="${sans_schema%%@*}"
  local apres_arobase="${sans_schema#*@}"
  local hote="${apres_arobase%%/*}"
  local projet="${apres_arobase##*/}"

  if [ -z "$cle" ] || [ -z "$hote" ] || [ -z "$projet" ] || [ "$hote" = "$sans_schema" ]; then
    echo "  (GlitchTip : SENTRY_DSN malformé, signal perdu : $message)" >&2
    return 0
  fi

  # Échappement JSON minimal (guillemets, antislashs) — le message vient toujours de CE dépôt
  # (jamais d'entrée utilisateur), mais un nom de tenant avec un caractère spécial ne doit pas
  # produire un JSON invalide silencieusement ignoré par GlitchTip.
  local message_json="${message//\\/\\\\}"
  message_json="${message_json//\"/\\\"}"

  local corps
  corps=$(printf '{"message":"%s","level":"%s","logger":"dfa-cron","platform":"other","tags":{"composant":"relances-cron"}}' \
    "$message_json" "$niveau")

  curl -fsS --max-time 10 \
    -H 'Content-Type: application/json' \
    -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=${cle}, sentry_client=dfa-cron-bash/1.0" \
    --data "$corps" \
    "https://${hote}/api/${projet}/store/" >/dev/null 2>&1 \
    || echo "  (GlitchTip : envoi de l'événement a échoué — $message)" >&2

  return 0
}
