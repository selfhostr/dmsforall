#!/usr/bin/env bash
# =================================================================================================
# purger.sh — rotation des sauvegardes locales (grand-père / père / fils), appelée par
# sauvegarder.sh après CHAQUE sauvegarde réussie (jamais après un échec : une nuit en échec doit
# laisser TOUT l'historique existant intact, pas réduire la marge de sécurité au pire moment).
#
# PURGE APPARIÉE (correction du 27.08.2026, depuis l'ajout du dump de rôles dans sauvegarder.sh) :
# chaque nuit produit DEUX fichiers partageant le même horodatage — `dfa_<horodatage>.dump.age`
# (schéma+données) et `dfa_<horodatage>.roles.sql.age` (rôles). Ce script pilote la décision
# GARDER/PURGER sur le fichier `.dump.age` (comme avant cette correction) et applique EXACTEMENT
# la même décision au `.roles.sql.age` de même horodatage — jamais l'inverse, et jamais une
# décision indépendante pour chacun : un dump schéma+données sans son dump de rôles correspondant
# est aussi inutilisable pour une restauration sur machine vierge qu'une absence totale (voir
# restaurer-test.sh), donc les deux fichiers d'une même nuit vivent et meurent ENSEMBLE. RESTE HORS
# DE CE SCRIPT, PAR CONCEPTION : la copie hors site (voir copier-hors-site.sh) n'est JAMAIS purgée
# depuis ce dépôt, quelle que soit la rétention locale décidée ici — un fichier peut donc rester
# indéfiniment hors site après avoir été purgé ici, voir la justification dans
# copier-hors-site.sh.
#
# Politique de rétention (identique à celle documentée pour l'ancienne cible S3, voir historique
# Git de ce fichier) :
#   - 7 jours de sauvegardes QUOTIDIENNES (toutes, sans distinction) ;
#   - 4 semaines de sauvegardes HEBDOMADAIRES (celle du dimanche de chaque semaine) ;
#   - 12 mois de sauvegardes MENSUELLES (celle du 1er de chaque mois).
# Pire cas de volume disque : 7 + 4 + 12 = 23 fichiers ; pire cas de couverture temporelle : un
# peu plus de 14 mois d'historique (12 mois pleins + le mois courant + la semaine courante). Un
# dump `pg_dump --format=custom` est déjà compressé (zlib, niveau par défaut) et le chiffrement
# `age` n'ajoute qu'une poignée d'octets d'en-tête — la taille totale du volume reste donc de
# l'ordre de grandeur d'UN dump compressé multiplié par ~23, pas 23x un dump en clair.
#
# Un fichier daté d'un jour donné qui correspond à PLUSIEURS règles à la fois (ex. le 1er janvier
# qui tombe un dimanche) n'est bien sûr compté qu'une fois — ce script GARDE un fichier dès qu'UNE
# des trois règles s'applique, ce qui produit naturellement ce comportement sans cas particulier.
#
# Limite connue, acceptée : si le service `backup` est arrêté (panne, maintenance) un dimanche ou
# un 1er du mois précis, ce créneau hebdomadaire/mensuel n'est simplement pas produit ce mois-là —
# pas de rattrapage automatique. Cohérent avec le choix général de ce chantier (une sauvegarde
# ratée est visible via le journal, pas rattrapée en silence).
# =================================================================================================
set -euo pipefail

DOSSIER="${1:?Usage: purger.sh <dossier-de-sauvegardes>}"
JOURNAL="$DOSSIER/journal.log"

RETENTION_QUOTIDIENNE_JOURS="${RETENTION_QUOTIDIENNE_JOURS:-7}"
RETENTION_HEBDOMADAIRE_JOURS="${RETENTION_HEBDOMADAIRE_JOURS:-28}"
RETENTION_MENSUELLE_JOURS="${RETENTION_MENSUELLE_JOURS:-365}"

maintenant_epoch="$(date +%s)"

cd "$DOSSIER"
# Files made before the prefix change are named dfa_prod_<timestamp>: both forms are handled.
for fichier in dfa_*.dump.age; do
  [ -e "$fichier" ] || continue

  horodatage="${fichier#dfa_}"
  horodatage="${horodatage#prod_}"
  horodatage="${horodatage%.dump.age}"
  jour="${horodatage%-*}" # YYYYmmdd

  # Nom de fichier qui ne correspond pas au format attendu (dépôt manuel d'un fichier étranger
  # dans ce dossier, par exemple) : on l'ignore plutôt que de risquer une suppression sur une date
  # mal interprétée.
  if ! [[ "$jour" =~ ^[0-9]{8}$ ]]; then
    continue
  fi

  jour_normalise="${jour:0:4}-${jour:4:2}-${jour:6:2}"
  if ! epoch_jour="$(date -d "$jour_normalise" +%s 2>/dev/null)"; then
    continue
  fi

  age_jours=$(((maintenant_epoch - epoch_jour) / 86400))
  jour_semaine="$(date -d "$jour_normalise" +%u)" # 1=lundi .. 7=dimanche
  jour_du_mois="$(date -d "$jour_normalise" +%d)"

  garder=0
  if [ "$age_jours" -le "$RETENTION_QUOTIDIENNE_JOURS" ]; then
    garder=1
  elif [ "$jour_semaine" = "7" ] && [ "$age_jours" -le "$RETENTION_HEBDOMADAIRE_JOURS" ]; then
    garder=1
  elif [ "$jour_du_mois" = "01" ] && [ "$age_jours" -le "$RETENTION_MENSUELLE_JOURS" ]; then
    garder=1
  fi

  if [ "$garder" -eq 0 ]; then
    rm -f -- "$fichier"
    echo "$(date -Iseconds) PURGE ${fichier} (${age_jours} jours)" >>"$JOURNAL"

    # Fichier de rôles apparié — voir l'en-tête « PURGE APPARIÉE ». `-f` : ne lève pas si le
    # fichier de rôles est déjà absent (sauvegarde antérieure à cette correction, ou déjà purgé).
    fichier_roles="${fichier%.dump.age}.roles.sql.age"
    if [ -e "$fichier_roles" ]; then
      rm -f -- "$fichier_roles"
      echo "$(date -Iseconds) PURGE ${fichier_roles} (appariée à ${fichier})" >>"$JOURNAL"
    fi
  fi
done
