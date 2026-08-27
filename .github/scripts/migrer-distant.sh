#!/usr/bin/env bash
# =================================================================================================
# migrer-distant.sh — exécuté SUR LE SERVEUR de production, via SSH, par
# .github/workflows/migrer.yml. Voir deployer-distant.sh (même dépôt) pour le patron d'ensemble.
#
# Variables d'environnement requises :
#   TAG              tag Git/image dont les migrations doivent être jouées
#   IMAGE_API        référence complète de l'image API (registre/propriétaire/dfa-api:TAG) — seule
#                     l'image API compte, `migrate` réutilise `dist/db/migrer.js` du même paquet
#   DEPLOY_CHEMIN    chemin du checkout Git de ce dépôt sur CE serveur
#
# Les conteneurs api/web/worker restent sur l'ANCIEN code pendant que ce script tourne — voir
# docs/deploiement-production.md §Séquence pour pourquoi c'est sûr (migrations expand/contract) et
# pourquoi c'est délibérément séparé de deployer-distant.sh.
# =================================================================================================
set -euo pipefail

: "${TAG:?TAG manquant}"
: "${IMAGE_API:?IMAGE_API manquant}"
: "${DEPLOY_CHEMIN:?DEPLOY_CHEMIN manquant}"

cd "$DEPLOY_CHEMIN"

git fetch --tags --force
git checkout --detach "$TAG"

# Seule la ligne API_IMAGE compte pour `migrate` (voir docker-compose.yml, service `migrate` :
# `image: ${API_IMAGE}`) — WEB_IMAGE n'a aucun rapport avec les migrations, jamais touchée ici.
sed -i "s|^API_IMAGE=.*|API_IMAGE=${IMAGE_API}|" .env.production

echo "→ Migration vers ${TAG} (rôle dfa_migrator, api/web/worker restent sur l'ancien code)..."
docker compose -f docker-compose.yml --env-file .env.production \
  --profile migration run --rm migrate

echo "OK — migrations de ${TAG} appliquées. Prochaine étape : déployer.yml sur ${TAG}."
