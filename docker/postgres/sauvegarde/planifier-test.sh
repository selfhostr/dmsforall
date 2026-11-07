#!/usr/bin/env bash
# =================================================================================================
# planifier-test.sh: optional monthly restore test (not in the default docker-compose.yml: run the backup image with this script as entrypoint).
# Boucle de sondage, MÊME PATRON que planifier.sh (voir son en-tête pour le « pourquoi une boucle
# plutôt qu'un cron interne ») : déclenche restaurer-test.sh une fois par mois, le JOUR_TEST_MENSUEL
# (défaut : le 1er), contre la DERNIÈRE sauvegarde disponible HORS SITE (jamais le volume local —
# voir « POURQUOI HORS SITE » ci-dessous, c'est la preuve demandée, pas un raccourci).
#
# --- POURQUOI CE MANQUE EXISTAIT (correction du 27.08.2026) -------------------------------------
# restaurer-test.sh existait déjà, mais personne ne l'appelait — une commande qu'il faut penser à
# taper chaque mois n'est, dans les faits, jamais tapée. « Une sauvegarde non testée n'existe pas »
# devient vrai seulement si le test tourne SANS qu'on ait à s'en souvenir.
#
# --- POURQUOI HORS SITE, PAS LE VOLUME LOCAL ----------------------------------------------------
# Le volume local prouve que pg_dump/pg_restore fonctionnent. Il ne prouve PAS que la copie hors
# site (copier-hors-site.sh) produit un fichier utilisable — or c'est PRÉCISÉMENT cette copie qui
# doit fonctionner le jour où la machine elle-même a disparu (incendie, vol, rançongiciel). Ce
# script récupère donc la DERNIÈRE paire de fichiers (données + rôles) directement depuis
# RCLONE_REMOTE avant de les restaurer — la preuve porte sur le mécanisme qui compte réellement.
#
# --- CLÉ DE TEST, PAS LA CLÉ RÉELLE (voir the backup documentation, "test key") -----
# La clé privée age RÉELLE ne vit JAMAIS sur ce serveur (voir restaurer.sh) — ce job automatisé
# mensuel ne peut donc PAS s'en servir. Il utilise AGE_CLE_PRIVEE_TEST_FICHIER, la moitié privée
# d'un DEUXIÈME destinataire age (AGE_CLE_PUBLIQUE_TEST côté sauvegarder.sh) dédié à CE SEUL usage.
# Compromission bornée, assumée et documentée : qui obtient cette clé de test obtient une COPIE de
# ce qu'un serveur déjà compromis donne de toute façon accès en clair (la base de production
# elle-même, sur ce même serveur) — jamais un nouveau périmètre.
#
# ABSENCE DE CONFIGURATION (RCLONE_REMOTE et/ou AGE_CLE_PRIVEE_TEST_FICHIER non posés) : ce service
# tourne quand même (healthcheck de vie, voir verifier-vivant.sh réutilisé tel quel), mais chaque
# tentative mensuelle échoue PROPREMENT avec un message explicite plutôt qu'un crash — cohérent
# avec la même doctrine que copier-hors-site.sh : dégradation ACCEPTÉE tant que l'hébergement n'est
# pas choisi, jamais un service qui refuse de démarrer pour autant.
#
# --- ÉCHEC : RETENTATIVE QUOTIDIENNE, PAS UN SILENCE D'UN MOIS ----------------------------------
# Une restauration de test qui échoue en silence jusqu'au mois suivant est PIRE que pas de test du
# tout (elle donne une fausse assurance) — donc un échec ne fait PAS attendre le 1er du mois
# suivant : ce script retente CHAQUE JOUR jusqu'à un succès, en écrivant ECHEC dans
# /sauvegardes/dernier-statut-restauration-test.txt et en journalisant bruyamment à CHAQUE tentative
# (visible via `docker compose logs restauration-test`) — impossible à manquer si on regarde les
# logs, contrairement à un échec qui se serait tu jusqu'au mois suivant.
# =================================================================================================
set -euo pipefail

JOUR_TEST_MENSUEL="${JOUR_TEST_MENSUEL:-1}"
POLL_SECONDES="${POLL_SECONDES:-30}"
FICHIER_VIVANT="${FICHIER_VIVANT:-/tmp/planifier-vivant}"
SAUVEGARDES_DIR="${SAUVEGARDES_DIR:-/sauvegardes}"
STATUT="$SAUVEGARDES_DIR/dernier-statut-restauration-test.txt"
RCLONE_CONFIG="${RCLONE_CONFIG:-/secrets/rclone.conf}"
export RCLONE_CONFIG

journaliser() {
  echo "$(date -Iseconds) [restauration-test] $1"
}

if ! [[ "$JOUR_TEST_MENSUEL" =~ ^([1-9]|1[0-9]|2[0-8])$ ]]; then
  echo "JOUR_TEST_MENSUEL invalide (attendu 1-28, reçu '${JOUR_TEST_MENSUEL}') — borné à 28 pour exister dans TOUS les mois, y compris février." >&2
  exit 1
fi

# Un mois où le dernier essai a ÉCHOUÉ est retenté chaque jour (voir en-tête) — ce marqueur
# distingue « déjà réussi pour ce mois-ci, ne pas re-tester inutilement chaque jour jusqu'au
# suivant » de « pas encore réussi ce mois-ci, retenter aujourd'hui même si ce n'est pas le
# JOUR_TEST_MENSUEL pile ». Recalculé, jamais persisté sur disque : un redémarrage de ce conteneur
# retente immédiatement plutôt que de faire confiance à un état sur disque potentiellement périmé.
dernier_mois_reussi=""

tenter_test() {
  local mois_aujourdhui
  mois_aujourdhui="$(date +%Y-%m)"

  if [ -z "${RCLONE_REMOTE:-}" ] || [ ! -s "$RCLONE_CONFIG" ]; then
    journaliser "NON CONFIGURÉ (RCLONE_REMOTE ou ${RCLONE_CONFIG} absent/vide) — test de restauration mensuel impossible tant que la copie hors site n'est pas configurée, voir the backup documentation"
    echo "NON_CONFIGURE $(date -Iseconds)" >"$STATUT"
    return 1
  fi
  if [ -z "${AGE_CLE_PRIVEE_TEST_FICHIER:-}" ] || [ ! -r "${AGE_CLE_PRIVEE_TEST_FICHIER:-/nonexistent}" ]; then
    journaliser "NON CONFIGURÉ (AGE_CLE_PRIVEE_TEST_FICHIER absente/illisible) — voir the backup documentation, "test key""
    echo "NON_CONFIGURE $(date -Iseconds)" >"$STATUT"
    return 1
  fi

  local zone tmp_donnees tmp_roles tmp_uploads nom_donnees nom_roles nom_uploads
  zone="$(mktemp -d)"
  journaliser "DEBUT — récupération de la dernière sauvegarde depuis ${RCLONE_REMOTE}"

  # Dernier fichier de données par ordre alphabétique = dernier par horodatage (format de nom
  # AAAAMMJJ-HHMMSS, voir sauvegarder.sh — tri lexicographique = tri chronologique).
  nom_donnees="$(rclone lsf "$RCLONE_REMOTE" --include 'dfa_*.dump.age' | sort | tail -n1)"
  if [ -z "$nom_donnees" ]; then
    journaliser "ECHEC aucune sauvegarde trouvée sur ${RCLONE_REMOTE}"
    echo "ECHEC $(date -Iseconds)" >"$STATUT"
    rm -rf -- "$zone"
    return 1
  fi
  nom_roles="${nom_donnees%.dump.age}.roles.sql.age"

  nom_uploads="${nom_donnees%.dump.age}.uploads.tar.gz.age"
  tmp_donnees="$zone/$nom_donnees"
  tmp_roles="$zone/$nom_roles"
  if ! rclone copyto "${RCLONE_REMOTE}/${nom_donnees}" "$tmp_donnees" \
    || ! rclone copyto "${RCLONE_REMOTE}/${nom_roles}" "$tmp_roles"; then
    journaliser "ECHEC récupération de ${nom_donnees}/${nom_roles} depuis ${RCLONE_REMOTE}"
    echo "ECHEC $(date -Iseconds)" >"$STATUT"
    rm -rf -- "$zone"
    return 1
  fi

  # Archive des fichiers déposés : absente des jeux antérieurs à son introduction (alors ignorée),
  # mais si le jeu en a une et qu'elle ne se récupère pas, c'est un ECHEC.
  tmp_uploads=""
  if rclone lsf "$RCLONE_REMOTE" --include "$nom_uploads" | grep -q .; then
    tmp_uploads="$zone/$nom_uploads"
    if ! rclone copyto "${RCLONE_REMOTE}/${nom_uploads}" "$tmp_uploads"; then
      journaliser "ECHEC récupération de ${nom_uploads} depuis ${RCLONE_REMOTE}"
      echo "ECHEC $(date -Iseconds)" >"$STATUT"
      rm -rf -- "$zone"
      return 1
    fi
  else
    journaliser "ATTENTION pas d'archive de fichiers (${nom_uploads}) hors site pour ce jeu"
  fi

  journaliser "récupérés : ${nom_donnees}, ${nom_roles} ${tmp_uploads:+et ${nom_uploads} }— lancement de restaurer-test.sh"
  if AGE_CLE_PRIVEE_FICHIER="$AGE_CLE_PRIVEE_TEST_FICHIER" /scripts/restaurer-test.sh "$tmp_donnees" "$tmp_roles" ${tmp_uploads:+"$tmp_uploads"}; then
    journaliser "OK — restauration de test réussie (${nom_donnees})"
    echo "OK $(date -Iseconds) ${nom_donnees}" >"$STATUT"
    rm -rf -- "$zone"
    dernier_mois_reussi="$mois_aujourdhui"
    return 0
  else
    journaliser "ECHEC — restauration de test échouée (${nom_donnees}) — voir le détail ci-dessus, RETENTATIVE DEMAIN"
    echo "ECHEC $(date -Iseconds) ${nom_donnees}" >"$STATUT"
    rm -rf -- "$zone"
    return 1
  fi
}

echo "$(date -Iseconds) planifier-test.sh démarré — test de restauration mensuel prévu le ${JOUR_TEST_MENSUEL} de chaque mois (retenté chaque jour en cas d'échec, voir en-tête)"

while true; do
  date -Iseconds >"$FICHIER_VIVANT"

  mois_courant="$(date +%Y-%m)"
  jour_courant="$(date +%-d)"

  if [ "$mois_courant" != "$dernier_mois_reussi" ] && [ "$jour_courant" -ge "$JOUR_TEST_MENSUEL" ]; then
    tenter_test || true
  fi

  sleep "$POLL_SECONDES"
done
