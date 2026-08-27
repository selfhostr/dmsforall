#!/usr/bin/env bash
# =================================================================================================
# copier-hors-site.sh — copie la sauvegarde chiffrée de LA NUIT (schéma+données + rôles) vers un
# stockage HORS DE CE SERVEUR, via rclone. Appelé par sauvegarder.sh en toute fin de run, jamais
# bloquant pour la sauvegarde locale (voir son en-tête) — un échec ici ne doit jamais faire
# régresser la fiabilité de la sauvegarde locale déjà réussie.
#
# --- POURQUOI CE MANQUE EXISTAIT, ET POURQUOI rclone (correction du 27.08.2026) ------------------
# Sans ce script, tout vit sur le volume local `dfa_postgres_backups` : une sauvegarde qui vit sur
# la machine qu'elle protège ne protège que du `DROP TABLE`/erreur humaine, jamais de l'incendie,
# du vol ou d'un rançongiciel qui chiffrerait le disque entier — le scénario même que « ne rien
# perdre » doit couvrir.
#
# rclone plutôt qu'un client propre à UN fournisseur (`aws s3`, `az`, etc.) : L'HÉBERGEMENT DE CE
# PROJET N'EST PAS ENCORE CHOISI (voir la correction de TRUST_PROXY_HOPS, même contrainte) — ce
# mécanisme doit être PORTABLE et ne présumer d'AUCUN fournisseur. rclone parle plus de 70
# protocoles/fournisseurs de stockage objet (S3-compatible générique — couvre Infomaniak Swiss
# Backup et Exoscale SOS si l'un des deux est retenu — Backblaze B2, SFTP vers un NAS personnel,
# WebDAV, etc.) derrière UNE SEULE interface (`rclone copyto <remote>:<chemin> <local>`) : changer
# de fournisseur plus tard est un changement de fichier de configuration, jamais un changement de
# ce script. Disponible en paquet Alpine officiel (`apk add rclone`, voir Dockerfile), aucune
# compilation/téléchargement à ce chantier.
#
# LE CHIFFREMENT age EST DÉJÀ FAIT AVANT D'ATTEINDRE CE SCRIPT (voir sauvegarder.sh) — c'est ce qui
# rend ce mécanisme sûr même vers une destination qui n'a PAS à être de confiance : ce script ne
# transmet jamais que des octets déjà illisibles sans la clé PRIVÉE age (qui, elle, ne quitte
# jamais l'endroit hors ligne où @laupernoe la conserve). Un fournisseur de stockage compromis, ou même
# malveillant, ne peut RIEN lire de ce qu'il reçoit ici.
#
# ADDITIF UNIQUEMENT, JAMAIS DE SUPPRESSION HORS SITE DEPUIS CE SCRIPT (décision délibérée,
# PAS un oubli) : `rclone copyto` (un fichier précis vers sa destination), jamais `rclone sync`
# (qui supprimerait côté distant tout ce qui a disparu localement). Un `sync` semblerait plus
# complet (miroir exact du volume local, y compris les purges de purger.sh) mais SUPPRIMERAIT AUSSI
# la copie hors site en cas de perte/corruption/rançongiciel LOCAL — exactement le scénario que ce
# mécanisme existe pour couvrir. Conséquence acceptée : le stockage hors site croît indéfiniment
# (jamais purgé par ce dépôt) — à borner par les règles de cycle de vie NATIVES du fournisseur
# retenu (quasi tous les services S3-compatible en proposent, ex. « supprimer après 400 jours »)
# une fois l'hébergement choisi, plutôt que réinventer une rotation distante ici.
#
# Usage : copier-hors-site.sh <sauvegardes-dir> <fichier-principal> <fichier-roles>
#
# Variables d'environnement :
#   RCLONE_REMOTE          ex. « offsite:dfa-prod/sauvegardes » (syntaxe rclone <remote>:<chemin>).
#                           ABSENTE ou VIDE ⇒ hors site désactivé PROPREMENT (pas une erreur qui
#                           casserait la sauvegarde locale, voir sauvegarder.sh) — attendu tant que
#                           l'hébergement n'est pas choisi. Statut consigné comme NON_CONFIGURE,
#                           PAS comme ECHEC (distinction utile : « pas encore fait » diffère de
#                           « configuré et cassé » — voir docs/exploitation-sauvegardes.md).
#   RCLONE_CONFIG           chemin du fichier de config rclone (secrets du fournisseur choisi,
#                           JAMAIS commité — voir secrets/rclone.conf, monté par
#                           docker-compose.yml, `.gitignore` couvre déjà `secrets/`). Défaut
#                           /secrets/rclone.conf. Un fichier ABSENT ou VIDE est traité comme
#                           « hors site pas encore configuré », même sort que RCLONE_REMOTE absent.
# =================================================================================================
set -euo pipefail

SAUVEGARDES_DIR="${1:?Usage: copier-hors-site.sh <sauvegardes-dir> <fichier-principal> <fichier-roles>}"
FICHIER_PRINCIPAL="${2:?Usage: copier-hors-site.sh <sauvegardes-dir> <fichier-principal> <fichier-roles>}"
FICHIER_ROLES="${3:?Usage: copier-hors-site.sh <sauvegardes-dir> <fichier-principal> <fichier-roles>}"

RCLONE_CONFIG="${RCLONE_CONFIG:-/secrets/rclone.conf}"
export RCLONE_CONFIG
STATUT="$SAUVEGARDES_DIR/dernier-statut-hors-site.txt"

journaliser() {
  echo "$(date -Iseconds) [hors-site] $1"
}

# Absence de configuration = état ATTENDU tant que l'hébergement n'est pas choisi (voir en-tête) —
# consigné distinctement de ECHEC, mais TOUJOURS journalisé : un manque qui ne s'affiche jamais
# nulle part est le manque qu'on oublie de traiter (même doctrine que le reste de ce chantier).
if [ -z "${RCLONE_REMOTE:-}" ] || [ ! -s "$RCLONE_CONFIG" ]; then
  journaliser "NON CONFIGURÉ (RCLONE_REMOTE ou ${RCLONE_CONFIG} absent/vide) — sauvegarde de cette nuit disponible UNIQUEMENT en local, voir docs/exploitation-sauvegardes.md « Copie hors site »"
  echo "NON_CONFIGURE $(date -Iseconds)" >"$STATUT"
  exit 1
fi

echo_erreur() {
  journaliser "ECHEC copie hors site (voir ci-dessus pour le détail rclone)"
  echo "ECHEC $(date -Iseconds)" >"$STATUT"
}
trap echo_erreur ERR

journaliser "DEBUT copie vers ${RCLONE_REMOTE}"
rclone copyto "$SAUVEGARDES_DIR/$FICHIER_PRINCIPAL" "${RCLONE_REMOTE}/${FICHIER_PRINCIPAL}"
rclone copyto "$SAUVEGARDES_DIR/$FICHIER_ROLES" "${RCLONE_REMOTE}/${FICHIER_ROLES}"

journaliser "OK copie de ${FICHIER_PRINCIPAL} et ${FICHIER_ROLES} vers ${RCLONE_REMOTE}"
echo "OK $(date -Iseconds)" >"$STATUT"
