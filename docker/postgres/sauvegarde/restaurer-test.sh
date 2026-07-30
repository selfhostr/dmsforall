#!/usr/bin/env bash
# =================================================================================================
# restaurer-test.sh — implémentation exécutable du test de restauration MENSUEL OBLIGATOIRE
# documenté dans docs/deploiement-production.md §7.2. « Une sauvegarde non testée n'existe pas » :
# ce script transforme cette exigence en commande que @laupernoe peut réellement taper, plutôt qu'une
# checklist manuelle en 6 étapes à suivre à la lettre chaque mois. GARDER EN SYNC avec §7.2 si
# l'un des deux change.
#
# Ce script ne touche JAMAIS dfa_dev, dfa_test, ni dfa_prod : il démarre sa PROPRE instance
# Postgres jetable (conteneur nommé, détruit en fin d'exécution quoi qu'il arrive — y compris en
# cas d'échec, voir le `trap` ci-dessous), restaure dedans, vérifie, puis détruit tout.
#
# Usage :
#   docker/postgres/sauvegarde/restaurer-test.sh <fichier.dump.age>
#
# Prérequis sur le poste/serveur qui exécute ce script : docker, age (avec la clé PRIVÉE
# disponible dans l'environnement de CETTE session uniquement — jamais laissée sur un serveur en
# continu, voir §7.2 point 2 et §2.4).
# =================================================================================================
set -euo pipefail

FICHIER="${1:?Usage: restaurer-test.sh <fichier.dump.age>}"
if [ ! -f "$FICHIER" ]; then
  echo "Introuvable : $FICHIER" >&2
  exit 1
fi

CONTENEUR="dfa-restauration-test-$$"
PORT_LOCAL="${PORT_LOCAL:-5433}"
DUMP_TMP="$(mktemp -d)/restauration.dump"

# Nettoyage systématique (conteneur jetable + dump déchiffré temporaire), même en cas d'échec à
# n'importe quelle étape — rien ne doit survivre à ce script, il est jetable par construction
# (§7.2 point 5).
nettoyer() {
  local code=$?
  docker rm -f "$CONTENEUR" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$DUMP_TMP")"
  exit "$code"
}
trap nettoyer EXIT

echo "→ [1/5] Démarrage d'une instance Postgres jetable (postgres:16-alpine, port ${PORT_LOCAL}, même version majeure que la production — voir §3.7 pour pourquoi c'est important après une montée de version majeure)..."
docker run -d --name "$CONTENEUR" \
  -e POSTGRES_PASSWORD=test-jetable \
  -e POSTGRES_DB=restauration_test \
  -p "127.0.0.1:${PORT_LOCAL}:5432" \
  postgres:16-alpine >/dev/null

echo "→ Attente de la disponibilité..."
pret=0
for _ in $(seq 1 30); do
  if docker exec "$CONTENEUR" pg_isready -U postgres >/dev/null 2>&1; then
    pret=1
    break
  fi
  sleep 1
done
if [ "$pret" -ne 1 ]; then
  echo "Postgres jetable jamais devenu disponible — abandon." >&2
  exit 1
fi

echo "→ [2/5] Déchiffrement (clé privée age requise dans l'environnement de cette session — jamais stockée sur ce serveur, §7.2 point 2)..."
age -d "$FICHIER" > "$DUMP_TMP"

echo "→ [3/5] Restauration (pg_restore, --no-owner : les rôles ne sont pas restaurés par ce dump, voir §3.7 sur ce point précis lors d'une montée de version majeure)..."
docker exec -i "$CONTENEUR" pg_restore -U postgres -d restauration_test --no-owner < "$DUMP_TMP"

echo "→ [4/5] Vérifications minimales (§7.2 point 4) :"
echo "  Nombre de tenants :"
docker exec "$CONTENEUR" psql -U postgres -d restauration_test -t -c "select count(*) from public.tenant;"
echo "  Utilisateurs au statut 'actif' (échantillon de cohérence) :"
docker exec "$CONTENEUR" psql -U postgres -d restauration_test -t -c "select count(*) from public.utilisateur where statut = 'actif';"
echo "  Posture RLS (rowsecurity activé sur les tables métier — vérification manuelle simplifiée de verifierPostureRls(), qui elle tourne côté application au démarrage avec les rôles dfa_app/dfa_migrator réels, absents ici) :"
docker exec "$CONTENEUR" psql -U postgres -d restauration_test -t -c "select count(*) from pg_tables where schemaname = 'public' and rowsecurity = false;"
echo "  (0 attendu sur la dernière ligne — toute table métier du schéma public sans RLS activé est une anomalie à investiguer avant de considérer ce test réussi.)"

echo "→ [5/5] OK. Nettoyage en cours (trap EXIT)."
echo ""
echo "RAPPEL (§7.2 point 6) : consigner la date et le résultat de CETTE exécution quelque part de"
echo "durable (changelog interne, ticket) — la preuve que la sauvegarde a été testée doit survivre"
echo "plus longtemps que cette instance jetable."
