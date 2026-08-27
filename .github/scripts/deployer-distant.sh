#!/usr/bin/env bash
# =================================================================================================
# deployer-distant.sh — exécuté SUR LE SERVEUR de production, via SSH, par
# .github/workflows/deployer.yml (jamais lancé directement en CI : ce fichier est piped comme
# stdin d'un `bash -s` distant, voir ce workflow pour la commande exacte).
#
# Variables d'environnement requises, posées par le workflow appelant AVANT ce script (jamais
# tapées en argument, cohérent avec la doctrine du reste du dépôt — voir
# docker/postgres/sauvegarde/*.sh) :
#   TAG              tag Git/image à déployer (ex. v0.5.0)
#   IMAGE_API        référence complète de l'image API (registre/propriétaire/dfa-api:TAG)
#   IMAGE_WEB        référence complète de l'image web
#   DEPLOY_CHEMIN    chemin du checkout Git de ce dépôt sur CE serveur
#
# NE JOUE AUCUNE MIGRATION — voir migrer-distant.sh (séparé, jamais appelé automatiquement par
# celui-ci) et docs/deploiement-production.md §Séquence pour pourquoi c'est délibéré.
# =================================================================================================
set -euo pipefail

: "${TAG:?TAG manquant}"
: "${IMAGE_API:?IMAGE_API manquant}"
: "${IMAGE_WEB:?IMAGE_WEB manquant}"
: "${DEPLOY_CHEMIN:?DEPLOY_CHEMIN manquant}"

cd "$DEPLOY_CHEMIN"

# Checkout du MÊME tag que l'image déployée : docker-compose.yml et
# docker/postgres/init/01-roles.sql doivent correspondre à la version qui tourne, jamais traîner
# en arrière ou en avance — voir docs/deploiement-production.md §Pourquoi un checkout Git sur le
# serveur (pas seulement des fichiers copiés).
git fetch --tags --force
git checkout --detach "$TAG"

# Remplace UNIQUEMENT les deux lignes API_IMAGE=/WEB_IMAGE= de .env.production — jamais un
# `cp`/écrasement du fichier entier, qui perdrait les secrets déjà en place (mots de passe, clés —
# voir .env.production.example, jamais versionné, jamais reconstruit depuis Git).
sed -i "s|^API_IMAGE=.*|API_IMAGE=${IMAGE_API}|" .env.production
sed -i "s|^WEB_IMAGE=.*|WEB_IMAGE=${IMAGE_WEB}|" .env.production

echo "→ Récupération des images..."
docker compose -f docker-compose.yml --env-file .env.production pull api web worker

echo "→ Recréation de api/web/worker (postgres/redis/backup non touchés)..."
docker compose -f docker-compose.yml --env-file .env.production up -d api web worker

echo "→ Attente de la disponibilité de l'API (GET /api/v1/sante)..."
pret=0
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.yml --env-file .env.production \
    exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    pret=1
    break
  fi
  sleep 2
done
if [ "$pret" -ne 1 ]; then
  echo "L'API ne répond pas 60s après le redémarrage — voir 'docker compose logs api'." >&2
  exit 1
fi

echo "OK — ${TAG} déployé (api=${IMAGE_API}, web=${IMAGE_WEB})."
