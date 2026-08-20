#!/usr/bin/env bash
# =================================================================================================
# restaurer.sh — remonte une base PostgreSQL depuis un fichier de sauvegarde chiffré
# (dfa_prod_AAAAMMJJ-HHMMSS.dump.age, produit par sauvegarder.sh). Pensé pour être utilisable sous
# pression, à 22h, sans avoir à réfléchir : deux arguments obligatoires, un seul indicateur, des
# messages en français à chaque étape.
#
# Usage :
#   docker/postgres/sauvegarde/restaurer.sh <fichier.dump.age> <base-cible> [--confirmer]
#
# <base-cible> : nom de la base PostgreSQL à (re)créer sur le conteneur `postgres` de PRODUCTION
#                (docker-compose.yml). N'écrase JAMAIS une base existante sans --confirmer
#                ET une seconde confirmation tapée à la main (voir plus bas) — deux gestes
#                distincts exprès, pour qu'un `--confirmer` ajouté par réflexe ou copié-collé d'une
#                commande précédente ne suffise pas à lui seul à écraser la base de production.
#
# Recommandé pour une restauration de PRODUCTION réelle : restaurer d'abord sous un nom TEMPORAIRE
# (ex. dfa_prod_restauration), vérifier son contenu, puis basculer l'application dessus
# manuellement (renommage de base ou changement de DATABASE_URL) plutôt que d'écraser dfa_prod
# directement — ce script permet les deux, le choix reste à l'opérateur.
#
# Variables d'environnement requises :
#   AGE_CLE_PRIVEE_FICHIER   chemin vers la clé PRIVÉE age qui déchiffre les sauvegardes. Cette clé
#                            ne vit JAMAIS sur ce serveur en permanence (voir sauvegarder.sh) — elle
#                            doit être apportée pour l'occasion (clé USB, gestionnaire de mots de
#                            passe de @laupernoe) et supprimée du serveur juste après. Ce script ne la lit
#                            qu'en lecture, ne la copie ni ne l'affiche jamais.
# Optionnelle :
#   RACINE_DEPOT             remplace la racine de dépôt déduite de l'emplacement de ce script —
#                            réservé aux tests (pointer vers une copie jetable de
#                            docker-compose.yml), jamais nécessaire en usage normal.
# =================================================================================================
set -euo pipefail

FICHIER="${1:-}"
BASE_CIBLE="${2:-}"
CONFIRMER=0
if [ "${3:-}" = "--confirmer" ]; then
  CONFIRMER=1
fi

if [ -z "$FICHIER" ] || [ -z "$BASE_CIBLE" ]; then
  cat >&2 <<'USAGE'
Usage : docker/postgres/sauvegarde/restaurer.sh <fichier.dump.age> <base-cible> [--confirmer]

  <fichier.dump.age>  sauvegarde à restaurer (voir /sauvegardes sur le serveur, ou une copie
                       récupérée hors site par @laupernoe).
  <base-cible>         nom de la base à créer/écraser sur le Postgres de production.
  --confirmer          requis en plus d'une confirmation tapée à la main si <base-cible> existe
                        déjà — sans ce risque, ce script ne touche jamais une base existante.

Variable requise : AGE_CLE_PRIVEE_FICHIER (chemin vers la clé privée age, jamais stockée sur ce
serveur en permanence).
USAGE
  exit 1
fi

if [ ! -r "$FICHIER" ]; then
  echo "Erreur : fichier de sauvegarde introuvable ou illisible : ${FICHIER}" >&2
  exit 1
fi

if ! [[ "$BASE_CIBLE" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "Erreur : nom de base invalide : '${BASE_CIBLE}' (lettres minuscules/chiffres/_ uniquement, ne commence pas par un chiffre)." >&2
  exit 1
fi

: "${AGE_CLE_PRIVEE_FICHIER:?AGE_CLE_PRIVEE_FICHIER manquant — chemin vers la clé privée age, apportée pour l\'occasion, jamais laissée sur ce serveur}"
if [ ! -r "$AGE_CLE_PRIVEE_FICHIER" ]; then
  echo "Erreur : clé privée age introuvable ou illisible : ${AGE_CLE_PRIVEE_FICHIER}" >&2
  exit 1
fi

RACINE_DEPOT="${RACINE_DEPOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
FICHIER_ENV="${RACINE_DEPOT}/.env.production"
if [ ! -r "$FICHIER_ENV" ]; then
  echo "Erreur : ${FICHIER_ENV} introuvable — ce script doit s'exécuter depuis un checkout du dépôt sur le serveur de production." >&2
  exit 1
fi

# Secrets Postgres lus depuis .env.production, jamais tapés en argument (voir docs de rotation des
# secrets, même règle qu'ailleurs dans ce projet) : `set -a` exporte tout ce que la source pose,
# `set +a` referme la portée aussitôt après pour ne pas exporter le reste du script par erreur.
set -a
# shellcheck disable=SC1090
. "$FICHIER_ENV"
set +a

: "${POSTGRES_SUPERUSER_PASSWORD:?POSTGRES_SUPERUSER_PASSWORD manquant dans ${FICHIER_ENV}}"
: "${POSTGRES_MIGRATOR_PASSWORD:?POSTGRES_MIGRATOR_PASSWORD manquant dans ${FICHIER_ENV}}"

COMPOSE=(docker compose -f "${RACINE_DEPOT}/docker-compose.yml" --env-file "$FICHIER_ENV")

psql_superviseur() {
  "${COMPOSE[@]}" exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -U dfa -d postgres -v ON_ERROR_STOP=1 -tA "$@"
}

echo "→ [1/5] Vérification de l'état de la base cible '${BASE_CIBLE}'..."
existe="$(psql_superviseur -c "select 1 from pg_database where datname = '${BASE_CIBLE}';")"

if [ "$existe" = "1" ]; then
  if [ "$CONFIRMER" -ne 1 ]; then
    echo "" >&2
    echo "REFUS : la base '${BASE_CIBLE}' existe déjà. Relancez avec --confirmer si vous voulez" >&2
    echo "vraiment l'écraser (les données actuelles de cette base seront perdues)." >&2
    exit 1
  fi

  echo "" >&2
  echo "ATTENTION : la base '${BASE_CIBLE}' existe déjà et va être DÉTRUITE puis recréée à partir" >&2
  echo "de la sauvegarde. Cette action est IRRÉVERSIBLE." >&2
  read -r -p "Tapez exactement le nom de la base pour confirmer (${BASE_CIBLE}) : " saisie
  if [ "$saisie" != "$BASE_CIBLE" ]; then
    echo "Saisie différente du nom attendu — abandon, rien n'a été touché." >&2
    exit 1
  fi

  echo "→ [2/5] Suppression de la base existante '${BASE_CIBLE}'..."
  psql_superviseur -c "drop database \"${BASE_CIBLE}\";" >/dev/null
else
  echo "→ [2/5] La base '${BASE_CIBLE}' n'existe pas encore — création directe."
fi

echo "→ [3/5] Création de la base '${BASE_CIBLE}' (propriétaire dfa_migrator)..."
psql_superviseur -c "create database \"${BASE_CIBLE}\" owner dfa_migrator;" >/dev/null

echo "→ [4/5] Déchiffrement en flux et restauration (pg_restore, aucun fichier en clair écrit) — peut prendre plusieurs minutes selon la taille de la sauvegarde..."
age -d -i "$AGE_CLE_PRIVEE_FICHIER" "$FICHIER" \
  | "${COMPOSE[@]}" exec -T -e PGPASSWORD="$POSTGRES_MIGRATOR_PASSWORD" postgres \
    pg_restore -U dfa_migrator -d "$BASE_CIBLE"

echo "→ [5/5] Vérifications rapides sur '${BASE_CIBLE}' :"
echo "  Tables du schéma public :"
psql_superviseur -c "\c ${BASE_CIBLE}" -c "select count(*) from information_schema.tables where table_schema = 'public';" | tail -n1
echo "  Tables du schéma public sans RLS activé (0 attendu — sinon anomalie à investiguer avant de considérer cette restauration utilisable) :"
psql_superviseur -c "\c ${BASE_CIBLE}" -c "select count(*) from pg_tables where schemaname = 'public' and rowsecurity = false;" | tail -n1

echo ""
echo "OK. Base '${BASE_CIBLE}' restaurée depuis $(basename "$FICHIER")."
echo "Rappel : cette base n'est PAS automatiquement celle que l'API utilise — pour la mettre en"
echo "service, ajustez DATABASE_URL/DATABASE_URL_MIGRATION dans .env.production puis redémarrez"
echo "le service api (docker compose ... up -d api), ou renommez cette base vers dfa_prod si vous"
echo "avez d'abord supprimé/renommé l'ancienne. Supprimez ${AGE_CLE_PRIVEE_FICHIER} de ce serveur"
echo "maintenant que la restauration est terminée — la clé privée ne doit pas y rester."
