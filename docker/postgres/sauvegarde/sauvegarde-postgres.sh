#!/usr/bin/env bash
# =================================================================================================
# sauvegarde-postgres.sh — sauvegarde logique quotidienne de PostgreSQL (dfa_prod), CHIFFRÉE EN
# FLUX (jamais un octet en clair sur disque), envoyée HORS SITE.
#
# CORRECTIF D'AUDIT : implémentation exécutable et versionnée du pipeline documenté en détail dans
# docs/deploiement-production.md §7.1 (qui explique le POURQUOI de chaque choix ci-dessous —
# pipeline sans fichier intermédiaire, age plutôt que GPG, rôle dfa_migrator, rétention — ce
# fichier ne réexplique pas, il exécute). Avant ce correctif, ce pipeline n'existait QUE comme
# prose dans la documentation — rien d'exécutable, rien de planifiable par un cron/systemd timer,
# rien à `chmod +x` et pointer directement. GARDER LES DEUX EN SYNC si l'un des deux change.
#
# Usage (cron ou systemd timer — JAMAIS de secret en argument de commande, voir §7.1/§8) :
#   set -a; . /opt/dfa/.env.production; set +a
#   AGE_CLE_PUBLIQUE=... S3_ENDPOINT=... S3_BUCKET=... docker/postgres/sauvegarde/sauvegarde-postgres.sh
#
# systemd timer : `EnvironmentFile=/opt/dfa/.env.production` dans l'unité .service correspondante,
# plus AGE_CLE_PUBLIQUE/S3_ENDPOINT/S3_BUCKET (secrets d'infrastructure, PAS dans
# .env.production qui est lu aussi par l'API — garder une séparation nette entre secrets
# applicatifs et secrets d'exploitation, même philosophie que POSTGRES_SUPERUSER_PASSWORD/
# REDIS_PASSWORD qui sont déjà hors du schéma zod de l'API).
#
# Variables requises dans l'environnement du planificateur (jamais codées en dur ici — un cron
# n'hérite d'aucun profil shell, `set -u` échouerait sinon avec un message générique "unbound
# variable" au lieu d'orienter l'astreinte vers la cause) :
#   AGE_CLE_PUBLIQUE   clé PUBLIQUE age (chiffrement asymétrique) — la clé privée correspondante ne
#                      doit JAMAIS se trouver sur ce serveur, uniquement dans un stockage hors
#                      ligne (gestionnaire de mots de passe de @laupernoe), sortie le temps d'un test de
#                      restauration (§7.2, voir restaurer-test.sh à côté de ce script).
#   S3_ENDPOINT        endpoint du stockage objet S3-compatible (ex. Infomaniak Swiss Backup,
#                       Exoscale SOS — fournisseur non tranché à ce jour, voir docs/
#                       deploiement-production.md §0).
#   S3_BUCKET           bucket de destination.
# + les identifiants attendus par `aws` lui-même (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, ou un
#   profil ~/.aws/credentials sur le serveur) — non listés ici, ce script ne les lit jamais
#   directement, il se contente d'invoquer `aws` qui les résout seul.
#
# Prérequis sur le serveur : `age` (chiffrement), `aws` (CLI, pour un stockage objet compatible S3
# — cible alternative sans tiers documentée en §7 point 2 : remplacer la dernière étape du
# pipeline par `ssh ... "cat > fichier"`, même principe de flux).
# =================================================================================================
set -euo pipefail

: "${AGE_CLE_PUBLIQUE:?AGE_CLE_PUBLIQUE manquant — clé publique age, voir docs/deploiement-production.md §7.1}"
: "${S3_ENDPOINT:?S3_ENDPOINT manquant — voir docs/deploiement-production.md §7.1}"
: "${S3_BUCKET:?S3_BUCKET manquant — voir docs/deploiement-production.md §7.1}"

# Racine du dépôt déduite de l'emplacement de ce script (docker/postgres/sauvegarde/ → 3 niveaux
# au-dessus), pas d'un chemin en dur (`/opt/dfa`, qui n'est qu'un exemple de la documentation) :
# ce script doit rester utilisable quel que soit le répertoire du checkout sur le serveur.
RACINE_DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="docker compose -f ${RACINE_DEPOT}/docker-compose.yml --env-file ${RACINE_DEPOT}/.env.production"

# Fichier de statut vérifiable (extension au-delà de ce que §7.1 documente aujourd'hui — à
# reporter dans la documentation si cette approche est retenue) : un cron/systemd timer qui échoue
# silencieusement équivaut à ne pas avoir de sauvegarde du tout (§7.1, dernier paragraphe). Ce
# fichier local horodaté permet à la sonde de disponibilité (§9, ou une vérification `find -mmin`
# simple) de détecter une sauvegarde manquante ou en échec sans dépendre uniquement des logs cron.
STATUT_FICHIER="${STATUT_FICHIER:-${RACINE_DEPOT}/.dernier-statut-sauvegarde}"
consigner_echec() {
  printf 'ECHEC %s\n' "$(date -Iseconds)" > "$STATUT_FICHIER"
}
trap consigner_echec ERR

DATE=$(date +%Y-%m-%dT%H%M%S)
FICHIER="dfa_prod_${DATE}.dump.age"

# Chiffrement asymétrique (age) : clé publique sur le serveur, clé privée UNIQUEMENT hors ligne —
# le fichier chiffré seul, sans la clé privée séparée, ne révèle rien. Tout en un seul pipeline,
# JAMAIS de fichier intermédiaire en clair sur disque : pg_dump (DANS le conteneur postgres, rôle
# dfa_migrator, propriétaire du schéma — pas besoin d'exposer le port 5432 sur l'hôte) → age
# (chiffrement, sortie stdout) → aws s3 cp - (lit l'entrée standard, upload en flux). `pipefail`
# (dans `set -euo pipefail` ci-dessus) fait échouer tout le pipeline si UN SEUL maillon échoue —
# y compris pg_dump, qui sinon laisserait passer un flux tronqué sans erreur visible côté age/aws.
$COMPOSE exec -T postgres pg_dump -U dfa_migrator -d dfa_prod --format=custom \
  | age -r "$AGE_CLE_PUBLIQUE" \
  | aws --endpoint-url "$S3_ENDPOINT" s3 cp - "s3://${S3_BUCKET}/postgres/${FICHIER}"

printf 'OK %s %s\n' "$FICHIER" "$(date -Iseconds)" > "$STATUT_FICHIER"
echo "sauvegarde-postgres.sh : ${FICHIER} envoyé vers s3://${S3_BUCKET}/postgres/ ($(date -Iseconds))"

# Rétention (§7.1) : 7 quotidiennes + 4 hebdomadaires + 12 mensuelles — appliquée côté politique de
# cycle de vie du bucket (la plupart des offres d'object storage suisses le permettent nativement),
# pas par ce script, pour rester simple et ne pas risquer de supprimer par erreur la seule copie
# valide depuis un script qui tourne sans supervision humaine directe.
