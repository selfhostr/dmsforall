#!/usr/bin/env bash
# =================================================================================================
# sauvegarder.sh — une sauvegarde de dfa_prod : pg_dump (format custom) → vérification structurelle
# → chiffrement age → écriture sur le volume dédié → rotation. Exécuté chaque nuit par
# planifier.sh à l'intérieur du service `backup` (docker-compose.yml) ; peut aussi être lancé
# à la main pour une sauvegarde hors planning (mêmes variables d'environnement requises).
#
# Le clair ne touche JAMAIS le disque persistant. pg_dump écrit dans SCRATCH_DIR, monté en
# `tmpfs:` par docker-compose.yml (mémoire, jamais le disque) — voir le commentaire du
# service `backup` pour pourquoi ce n'est pas un pipeline 100% sans fichier intermédiaire (comme
# le faisait l'ancienne version de ce script vers S3, cf. historique Git) : la vérification
# structurelle du dump (`pg_restore --list`) doit pouvoir relire le contenu réel du dump AVANT
# chiffrement, or la clé PRIVÉE age n'est délibérément jamais présente sur ce serveur (voir plus
# bas) — un pipeline sans fichier intermédiaire empêcherait donc toute vérification automatique
# nocturne. Le compromis retenu : un fichier intermédiaire, mais en RAM (tmpfs), à permissions
# restreintes, supprimé par le `trap` ci-dessous quoi qu'il arrive (succès, échec, script tué).
#
# Variables d'environnement requises (posées par docker-compose.yml, service `backup`) :
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD   connexion au Postgres du réseau `interne`
#   AGE_CLE_PUBLIQUE                                  clé PUBLIQUE age — la clé privée
#                                                      correspondante ne doit JAMAIS se trouver sur
#                                                      ce serveur (voir restaurer.sh/
#                                                      restaurer-test.sh, qui l'exigent en entrée
#                                                      hors ligne au moment du besoin).
# Optionnelles :
#   SAUVEGARDES_DIR (défaut /sauvegardes), SCRATCH_DIR (défaut /scratch),
#   SEUIL_TAILLE_MIN_POURCENT (défaut 50) — en-dessous de ce pourcentage de la taille de la
#   dernière sauvegarde connue, la sauvegarde du jour est considérée suspecte (probable dump
#   tronqué) et REJETÉE plutôt que conservée : une sauvegarde manquante se voit immédiatement
#   (journal + dernier-statut.txt) alors qu'une sauvegarde silencieusement tronquée ne se
#   découvre qu'au moment de la restaurer — trop tard.
# =================================================================================================
set -euo pipefail

: "${PGHOST:?PGHOST manquant}"
: "${PGPORT:=5432}"
: "${PGDATABASE:?PGDATABASE manquant}"
: "${PGUSER:?PGUSER manquant}"
: "${PGPASSWORD:?PGPASSWORD manquant — jamais en argument de commande, seulement en variable d\'environnement (voir docker-compose.yml, service backup)}"
: "${AGE_CLE_PUBLIQUE:?AGE_CLE_PUBLIQUE manquant — clé publique age (age-keygen), jamais la clé privée sur ce serveur}"
export PGPASSWORD

SAUVEGARDES_DIR="${SAUVEGARDES_DIR:-/sauvegardes}"
SCRATCH_DIR="${SCRATCH_DIR:-/scratch}"
SEUIL_TAILLE_MIN_POURCENT="${SEUIL_TAILLE_MIN_POURCENT:-50}"

JOURNAL="$SAUVEGARDES_DIR/journal.log"
STATUT="$SAUVEGARDES_DIR/dernier-statut.txt"

# Toute la sortie de ce script (y compris celle des commandes externes qu'il lance) va à la fois
# sur la sortie standard (visible via `docker compose logs backup`) et dans le journal durable du
# volume — UNE seule écriture par ligne, pas de risque de doublon (voir le commentaire détaillé
# dans le rapport de livraison : une version précédente de ce script écrivait explicitement dans
# le journal ET laissait crond rediriger la même sortie une deuxième fois).
exec > >(tee -a "$JOURNAL") 2>&1

journaliser() {
  echo "$(date -Iseconds) $1"
}

DATE="$(date +%Y%m%d-%H%M%S)"
FICHIER_FINAL="$SAUVEGARDES_DIR/dfa_prod_${DATE}.dump.age"
TMP="$(mktemp --suffix=.dump "${SCRATCH_DIR}/dfa-XXXXXX")"
chmod 600 "$TMP"

# Nettoyage du dump en clair (tmpfs) quoi qu'il arrive, ET consignation d'un ECHEC si le script
# s'arrête sur une erreur — GÉRÉS PAR DEUX TRAPS SÉPARÉS, jamais par un `if fonction; then ... else
# ... fi` autour d'une fonction qui engloberait toute la logique : piège bash vérifié pendant les
# tests de ce chantier, à ne PAS reproduire — `set -e` est SILENCIEUSEMENT désactivé pour la durée
# COMPLÈTE d'une fonction appelée comme condition d'un `if`/`&&`/`||` (pas seulement pour son appel
# lui-même), donc `age`/`pg_dump`/`pg_restore` en échec À L'INTÉRIEUR d'une telle fonction ne
# stoppaient PAS le script — reproduit concrètement : `age` en échec (permission refusée) suivi
# quand même d'un « OK sauvegarde » écrit dans le journal. D'où la structure ci-dessous : tout le
# corps du script est au niveau racine (jamais dans une fonction appelée conditionnellement), et
# c'est un `trap ... ERR` qui journalise l'échec — un `trap` ne désactive PAS `set -e`, contrairement
# à un `if`.
nettoyer() {
  rm -f -- "$TMP"
}
trap nettoyer EXIT

consigner_echec() {
  code=$?
  journaliser "ECHEC sauvegarde (code ${code})"
  echo "ECHEC $(date -Iseconds)" >"$STATUT" 2>/dev/null || true
}
trap consigner_echec ERR

journaliser "DEBUT sauvegarde de ${PGDATABASE}@${PGHOST}"

pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --format=custom --file="$TMP"

# Vérification structurelle AVANT chiffrement (voir l'en-tête du fichier : c'est justement
# pourquoi le fichier intermédiaire en tmpfs existe). Un dump tronqué ou corrompu fait échouer
# `pg_restore --list` avec un code de sortie non nul, capturé par `set -e`.
pg_restore --list "$TMP" >/dev/null

age -r "$AGE_CLE_PUBLIQUE" -o "$FICHIER_FINAL" "$TMP"

taille_octets="$(wc -c <"$FICHIER_FINAL")"
taille_octets="${taille_octets// /}"

# `ls`/`grep`/`sort` plutôt que `find -printf` : busybox (Alpine) n'a pas l'extension GNU
# `-printf`, et `findutils` n'apporterait rien d'autre d'utile ici.
precedent="$(cd "$SAUVEGARDES_DIR" && ls -1 dfa_prod_*.dump.age 2>/dev/null \
  | grep -F -v -- "$(basename "$FICHIER_FINAL")" | sort | tail -n1 || true)"

if [ -n "${precedent:-}" ]; then
  taille_precedente="$(wc -c <"$SAUVEGARDES_DIR/$precedent")"
  taille_precedente="${taille_precedente// /}"
  if [ "$taille_precedente" -gt 0 ]; then
    pourcent=$((taille_octets * 100 / taille_precedente))
    if [ "$pourcent" -lt "$SEUIL_TAILLE_MIN_POURCENT" ]; then
      journaliser "ECHEC taille suspecte : ${taille_octets} octets, soit ${pourcent}% de la précédente (${precedent} : ${taille_precedente} octets) — seuil ${SEUIL_TAILLE_MIN_POURCENT}%, sauvegarde REJETÉE"
      rm -f -- "$FICHIER_FINAL"
      echo "ECHEC $(date -Iseconds)" >"$STATUT"
      exit 1
    fi
  fi
fi

journaliser "OK sauvegarde $(basename "$FICHIER_FINAL") (${taille_octets} octets)"

"$(dirname "${BASH_SOURCE[0]}")/purger.sh" "$SAUVEGARDES_DIR"

echo "OK $(date -Iseconds)" >"$STATUT"
