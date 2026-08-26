#!/usr/bin/env bash
# Point d'entrée UNIQUE du harnais e2e — voir e2e/README.md pour le détail. Usage :
#
#   e2e/scripts/executer.sh build [args playwright...]   (défaut — front BUILDÉ + prévisualisé)
#   e2e/scripts/executer.sh dev   [args playwright...]   (contre `pnpm dev` déjà en cours)
#
# Ce que ce script fait, dans l'ordre :
#   1. calcule l'IP LAN de l'hôte (voir detecter-ip-hote.sh — c'est le SEUL chemin qui traverse
#      Docker rootless en `--disable-host-loopback`, mesuré : ni localhost, ni
#      host.docker.internal, ni le réseau `bridge` par défaut seuls ne suffisent) ;
#   2. cible `build` seulement : build le front, démarre `vite preview` + proxy /api -> API déjà
#      en cours sur l'hôte (voir support/vite.preview.config.ts), attend sa disponibilité, VÉRIFIE
#      que le bundle réellement servi correspond au build qui vient d'être produit (piège
#      CONTRIBUTING.md : « HTTP 200 sur la racine ne prouve rien ») ;
#   3. lance `playwright test` DANS le conteneur `mcr.microsoft.com/playwright:v1.62.1-jammy`,
#      dépôt entier monté en lecture-écriture (rapports/traces écrits directement sur l'hôte) ;
#   4. arrête proprement ce qu'il a démarré (jamais les process de @laupernoe : `pnpm dev` n'est JAMAIS
#      touché par ce script).
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_PLAYWRIGHT='mcr.microsoft.com/playwright:v1.62.1-jammy'
PORT_PREVIEW=4173
PORT_API_AMBIANTE=3000

CIBLE="${1:-build}"
if [[ "${1:-}" == "build" || "${1:-}" == "dev" ]]; then shift; fi

IP_HOTE="$("$RACINE/e2e/scripts/detecter-ip-hote.sh")"
if [[ -z "$IP_HOTE" ]]; then
  echo "Impossible de déterminer l'IP LAN de l'hôte (voir e2e/scripts/detecter-ip-hote.sh)." >&2
  exit 1
fi
echo "IP hôte (vue depuis le conteneur) : $IP_HOTE"

PID_PREVIEW=""
nettoyer() {
  if [[ -n "$PID_PREVIEW" ]] && kill -0 "$PID_PREVIEW" 2>/dev/null; then
    echo "Arrêt du serveur de prévisualisation (PID $PID_PREVIEW)."
    kill "$PID_PREVIEW" 2>/dev/null || true
    wait "$PID_PREVIEW" 2>/dev/null || true
  fi
}
trap nettoyer EXIT

attendre_http() {
  local url="$1" tentatives="${2:-60}"
  for ((i = 0; i < tentatives; i++)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

case "$CIBLE" in
  build)
    if ! attendre_http "http://127.0.0.1:$PORT_API_AMBIANTE/api/v1/sante" 3; then
      echo "API introuvable sur le port $PORT_API_AMBIANTE. La cible « build » teste le front" >&2
      echo "buildé CONTRE l'API déjà en cours (pnpm dev / pnpm dev:api) — la démarrer d'abord." >&2
      exit 1
    fi

    echo "Build du front (pnpm --filter @dfa/web build)…"
    (cd "$RACINE" && pnpm --filter @dfa/web build)

    # `vite preview --config` bundle sa config dans le node_modules le plus proche du FICHIER de
    # config (Vite : `findNearestNodeModules`, voir e2e/README.md « Pourquoi ce symlink »)  — pas
    # du cwd. `e2e/` est volontairement hors du workspace pnpm (e2e/package.json), donc sans ce
    # symlink cette remontée atterrit sur node_modules RACINE, qui n'a aucun paquet `vite` hissé
    # (isolé sous apps/web/node_modules) : `ERR_MODULE_NOT_FOUND` à l'import de la config bundlée.
    # Recréé à chaque run (idempotent, jamais commité — /e2e/node_modules via la règle générique
    # node_modules/ du .gitignore) pour rester aligné sur la version que pnpm a réellement résolue
    # pour apps/web, quelle que soit l'évolution de cette version.
    mkdir -p "$RACINE/e2e/node_modules"
    ln -sfn "$(readlink -f "$RACINE/apps/web/node_modules/vite")" "$RACINE/e2e/node_modules/vite"

    echo "Démarrage de la prévisualisation (port $PORT_PREVIEW, proxy /api -> :$PORT_API_AMBIANTE)…"
    JOURNAL_PREVIEW="$(mktemp)"
    (
      cd "$RACINE" && \
      pnpm --filter @dfa/web exec vite preview --config "$RACINE/e2e/support/vite.preview.config.ts"
    ) >"$JOURNAL_PREVIEW" 2>&1 &
    PID_PREVIEW=$!

    if ! attendre_http "http://127.0.0.1:$PORT_PREVIEW/" 30; then
      echo "La prévisualisation n'a jamais répondu — journal :" >&2
      cat "$JOURNAL_PREVIEW" >&2
      exit 1
    fi

    # Piège CONTRIBUTING.md : un 200 sur / ne prouve rien, il faut vérifier le BUNDLE réellement servi.
    # Compare le hash de build référencé par le dist fraîchement produit à celui que la
    # prévisualisation sert vraiment — détecte un ancien process resté sur le port, ou un dist
    # périmé.
    ATTENDU="$(grep -o 'assets/index-[^"]*\.js' "$RACINE/apps/web/dist/index.html" | head -n1)"
    SERVI="$(curl -fsS "http://127.0.0.1:$PORT_PREVIEW/" | grep -o 'assets/index-[^"]*\.js' | head -n1)"
    if [[ -z "$ATTENDU" || "$ATTENDU" != "$SERVI" ]]; then
      echo "Bundle servi ($SERVI) différent du build fraîchement produit ($ATTENDU) — un" >&2
      echo "process de prévisualisation périmé occupe peut-être déjà le port $PORT_PREVIEW." >&2
      exit 1
    fi
    echo "Bundle vérifié : $SERVI (identique au build produit à l'instant)."

    BASE_URL="http://$IP_HOTE:$PORT_PREVIEW"
    ;;
  dev)
    if ! attendre_http "http://127.0.0.1:5173/" 3 || ! attendre_http "http://127.0.0.1:$PORT_API_AMBIANTE/api/v1/sante" 3; then
      echo "Front (:5173) et/ou API (:$PORT_API_AMBIANTE) introuvables — lancer \`pnpm dev\` d'abord." >&2
      exit 1
    fi
    BASE_URL="http://$IP_HOTE:5173"
    ;;
  *)
    echo "Cible inconnue « $CIBLE » — attendu « build » ou « dev »." >&2
    exit 1
    ;;
esac

echo "BASE_URL=$BASE_URL"
echo "Lancement de Playwright dans $IMAGE_PLAYWRIGHT…"

docker run --rm \
  --ipc=host \
  -v "$RACINE:/workspace" \
  -w /workspace \
  -e BASE_URL="$BASE_URL" \
  -e CI="${CI:-}" \
  -e PW_WORKERS="${PW_WORKERS:-}" \
  -e PW_RETRIES="${PW_RETRIES:-}" \
  "$IMAGE_PLAYWRIGHT" \
  npx playwright test --config e2e/playwright.config.ts "$@"
