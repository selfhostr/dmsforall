#!/usr/bin/env bash
# =================================================================================================
# sauvegarder.sh — une sauvegarde de dfa_prod, EN DEUX PARTIES (schéma+données ET rôles, voir plus
# bas pourquoi les deux sont indispensables), chacune : dump → vérification structurelle →
# chiffrement age → écriture sur le volume dédié. Rotation locale (purger.sh) puis copie hors site
# (copier-hors-site.sh, non bloquante) en fin de script. Exécuté chaque nuit par planifier.sh à
# l'intérieur du service `backup` (docker-compose.yml) ; peut aussi être lancé à la main pour
# une sauvegarde hors planning (mêmes variables d'environnement requises).
#
# Le clair ne touche JAMAIS le disque persistant. pg_dump/pg_dumpall écrivent dans SCRATCH_DIR,
# monté en `tmpfs:` par docker-compose.yml (mémoire, jamais le disque) — voir le commentaire
# du service `backup` pour pourquoi ce n'est pas un pipeline 100% sans fichier intermédiaire (comme
# le faisait l'ancienne version de ce script vers S3, cf. historique Git) : la vérification
# structurelle du dump (`pg_restore --list`) doit pouvoir relire le contenu réel du dump AVANT
# chiffrement, or la clé PRIVÉE age n'est délibérément jamais présente sur ce serveur en continu
# (voir plus bas) — un pipeline sans fichier intermédiaire empêcherait donc toute vérification
# automatique nocturne. Le compromis retenu : un fichier intermédiaire, mais en RAM (tmpfs), à
# permissions restreintes, supprimé par le `trap` ci-dessous quoi qu'il arrive (succès, échec,
# script tué).
#
# --- POURQUOI UN DEUXIÈME DUMP, LES RÔLES (correction du 27.08.2026, sur constat) --------------
# `pg_dump --format=custom` (schéma+données ci-dessous) ne couvre JAMAIS les rôles PostgreSQL
# (CREATE ROLE, mots de passe, `VALID UNTIL`) — ce sont des objets DU CLUSTER, pas de la base.
# `docker/postgres/init/01-roles.sql` les recrée automatiquement au tout premier démarrage d'un
# volume Postgres VIDE (docker-compose.yml monte ce script), donc le cas courant (repartir
# d'un `docker compose up` neuf sur ce même dépôt) n'échoue PAS à proprement parler — mais il
# recrée les rôles avec les MOTS DE PASSE DE DEV (dfa_app_dev/dfa_migrator_dev/dfa_console_dev,
# publiés dans le dépôt Git), jamais les mots de passe RÉELLEMENT en usage en production au moment
# du sinistre. Un `.env.production` restauré à l'identique ne pourrait alors PAS se reconnecter
# tant qu'une rotation manuelle n'a pas été rejouée EN PLUS de la restauration elle-même — au pire
# moment pour découvrir cette étape. Un `pg_dumpall --roles-only` capture les VRAIS mots de passe
# (hashés) et échéances `VALID UNTIL` en vigueur au moment de CETTE sauvegarde précise : une
# restauration qui le rejoue retrouve exactement les identifiants que `.env.production` attend
# déjà, sans étape de rotation supplémentaire pendant un incident. Robuste aussi au cas où
# `01-roles.sql` aurait divergé de ce qui tournait réellement (dérive non voulue), ou où la
# restauration se ferait sur un Postgres qui n'a jamais vu ce script.
#
# ATTENTION, CE DUMP CONTIENT DES EMPREINTES DE MOTS DE PASSE (hash SCRAM, jamais le mot de passe
# en clair, mais un secret d'authentification réel) — chiffré `age` comme le reste, jamais écrit
# en clair sur le volume persistant, mêmes garanties que le dump schéma+données.
#
# NÉCESSITE LE SUPERUSER — ET C'EST AUSSI VRAI, DÉCOUVERT EN VÉRIFIANT PLUTÔT QU'EN SUPPOSANT, DU
# DUMP SCHÉMA+DONNÉES CI-DESSUS, PAS SEULEMENT DE CELUI-CI :
#   - Rôles : PostgreSQL ne rend les empreintes de mot de passe d'AUTRES rôles visibles qu'au
#     superuser (`pg_roles`/`pg_authid` masquent `rolpassword` pour tout rôle non-superuser, même
#     propriétaire du schéma) — `dfa_migrator`, volontairement NOSUPERUSER, ne peut PAS produire ce
#     dump.
#   - Schéma+données : REPRODUIT EN EXÉCUTION (pas une hypothèse) pendant ce chantier — `pg_dump`
#     connecté en `dfa_migrator` échoue sur CHAQUE table protégée par RLS avec « ERROR: query
#     would be affected by row-level security policy », HINT « ALTER TABLE NO FORCE ROW LEVEL
#     SECURITY ». Cause : TOUTES les tables métier portent `FORCE ROW LEVEL SECURITY` (0001, 0004,
#     0005…), qui s'applique même au PROPRIÉTAIRE de la table (`dfa_migrator`, `ALTER SCHEMA
#     public OWNER TO dfa_migrator` dans 01-roles.sql) dès lors qu'il n'a pas BYPASSRLS — exactement
#     le cas de `dfa_migrator`. `pg_dump` pose `row_security = off` pour obtenir un dump complet et
#     cohérent ; sur un rôle NOBYPASSRLS, Postgres refuse alors la requête plutôt que de risquer un
#     dump silencieusement filtré (tronqué à zéro ligne, pire que l'erreur) — donc UN SEUL dump
#     COMPLET est possible sans BYPASSRLS : celui fait par le superuser. `dfa_migrator` n'était donc
#     JAMAIS EN MESURE de produire une sauvegarde complète de ce projet, RLS forcé compris — ce
#     chantier corrige les DEUX dumps vers le superuser, pas seulement celui des rôles.
#
# BYPASSRLS EXPLICITEMENT ÉCARTÉ pour `dfa_migrator` PLUTÔT QUE la solution retenue ici (reposer
# sur le superuser existant) : ce projet interdit ce contournement PARTOUT ailleurs (voir
# 01-roles.sql, « L'API ne doit donc JAMAIS se connecter avec dfa ») — l'accorder à `dfa_migrator`
# NON PLUS UNIQUEMENT pour la sauvegarde ferait de lui un rôle à double visage (RLS respecté en
# migration, contourné en sauvegarde), une source de confusion durable. Le superuser `dfa` est
# DÉJÀ l'exception documentée et bornée du projet pour ce type d'opération hors ligne ponctuelle
# (init, rotation de mots de passe — voir docker-compose.yml, service `postgres`) : la
# sauvegarde nocturne en devient une troisième, plutôt que d'en ouvrir une quatrième.
#
# Variables d'environnement requises (posées par docker-compose.yml, service `backup`) :
#   PGHOST, PGPORT, PGDATABASE                        connexion réseau et base cible
#   PGUSER, PGPASSWORD                                 rôle SUPERUSER (dfa) — voir ci-dessus pour
#                                                       pourquoi les DEUX dumps l'exigent
#   AGE_CLE_PUBLIQUE                                   clé PUBLIQUE age — la clé privée
#                                                       correspondante ne doit JAMAIS se trouver sur
#                                                       ce serveur (voir restaurer.sh, qui l'exige
#                                                       en entrée hors ligne au moment du besoin).
# Optionnelles :
#   AGE_CLE_PUBLIQUE_TEST — clé PUBLIQUE age D'UN SECOND DESTINATAIRE, dédiée au test de
#     restauration MENSUEL AUTOMATISÉ (voir restaurer-test.sh/planifier-test.sh et
#     docs/exploitation-sauvegardes.md « Clé de test »). Si posée, CHAQUE fichier est chiffré pour
#     LES DEUX destinataires (`age -r ... -r ...`) — la clé privée correspondante peut, elle,
#     rester sur ce serveur (voir la justification complète dans les docs : compromission de cette
#     clé seule ne donne accès qu'à une COPIE des données déjà accessibles en clair sur ce même
#     serveur compromis, pas à un nouveau périmètre). Absente : le test mensuel ne peut pas
#     tourner sans intervention humaine (apport de la clé privée RÉELLE, hors ligne) — dégradation
#     ACCEPTÉE, jamais un blocage de la sauvegarde elle-même.
#   SAUVEGARDES_DIR (défaut /sauvegardes), SCRATCH_DIR (défaut /scratch),
#   SEUIL_TAILLE_MIN_POURCENT (défaut 50) — en-dessous de ce pourcentage de la taille de la
#   dernière sauvegarde connue, la sauvegarde du jour est considérée suspecte (probable dump
#   tronqué) et REJETÉE plutôt que conservée : une sauvegarde manquante se voit immédiatement
#   (journal + dernier-statut.txt) alors qu'une sauvegarde silencieusement tronquée ne se
#   découvre qu'au moment de la restaurer — trop tard. Ce seuil ne s'applique qu'au dump
#   schéma+données (le dump de rôles est minuscule et sa taille ne dit rien d'un problème).
#   RCLONE_REMOTE — voir copier-hors-site.sh, appelé en fin de script (non bloquant).
# =================================================================================================
set -euo pipefail

: "${PGHOST:?PGHOST manquant}"
: "${PGPORT:=5432}"
: "${PGDATABASE:?PGDATABASE manquant}"
: "${PGUSER:?PGUSER manquant — rôle SUPERUSER (dfa), voir en-tête pour pourquoi}"
: "${PGPASSWORD:?PGPASSWORD manquant — jamais en argument de commande, seulement en variable d\'environnement (voir docker-compose.yml, service backup)}"
: "${AGE_CLE_PUBLIQUE:?AGE_CLE_PUBLIQUE manquant — clé publique age (age-keygen), jamais la clé privée sur ce serveur}"

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
FICHIER_ROLES_FINAL="$SAUVEGARDES_DIR/dfa_prod_${DATE}.roles.sql.age"
TMP="$(mktemp --suffix=.dump "${SCRATCH_DIR}/dfa-XXXXXX")"
TMP_ROLES="$(mktemp --suffix=.sql "${SCRATCH_DIR}/dfa-roles-XXXXXX")"
chmod 600 "$TMP" "$TMP_ROLES"

# Nettoyage des DEUX fichiers en clair (tmpfs) quoi qu'il arrive, ET consignation d'un ECHEC si le
# script s'arrête sur une erreur — GÉRÉS PAR DEUX TRAPS SÉPARÉS, jamais par un `if fonction; then
# ... else ... fi` autour d'une fonction qui engloberait toute la logique : piège bash vérifié
# pendant les tests de ce chantier, à ne PAS reproduire — `set -e` est SILENCIEUSEMENT désactivé
# pour la durée COMPLÈTE d'une fonction appelée comme condition d'un `if`/`&&`/`||` (pas seulement
# pour son appel lui-même), donc `age`/`pg_dump`/`pg_restore` en échec À L'INTÉRIEUR d'une telle
# fonction ne stoppaient PAS le script — reproduit concrètement : `age` en échec (permission
# refusée) suivi quand même d'un « OK sauvegarde » écrit dans le journal. D'où la structure
# ci-dessous : tout le corps du script est au niveau racine (jamais dans une fonction appelée
# conditionnellement), et c'est un `trap ... ERR` qui journalise l'échec — un `trap` ne désactive
# PAS `set -e`, contrairement à un `if`.
nettoyer() {
  rm -f -- "$TMP" "$TMP_ROLES"
}
trap nettoyer EXIT

consigner_echec() {
  code=$?
  journaliser "ECHEC sauvegarde (code ${code})"
  echo "ECHEC $(date -Iseconds)" >"$STATUT" 2>/dev/null || true
}
trap consigner_echec ERR

journaliser "DEBUT sauvegarde de ${PGDATABASE}@${PGHOST}"

# --- 1. Schéma + données (superuser — voir en-tête « NÉCESSITE LE SUPERUSER ») ------------------
PGPASSWORD="$PGPASSWORD" pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$PGDATABASE" --format=custom --file="$TMP"

# Vérification structurelle AVANT chiffrement (voir l'en-tête du fichier : c'est justement
# pourquoi le fichier intermédiaire en tmpfs existe). Un dump tronqué ou corrompu fait échouer
# `pg_restore --list` avec un code de sortie non nul, capturé par `set -e`. NE PROUVE QUE LA
# STRUCTURE (table des matières du format custom) — un dump dont le TOC est intact mais dont le
# CONTENU d'une table serait vide passerait ce contrôle sans broncher (une entrée TOC « TABLE DATA »
# existe même pour zéro ligne). Voir le contrôle ABSOLU juste en dessous pour ce que ceci ne
# couvre pas.
pg_restore --list "$TMP" >/dev/null

# --- 1bis. Contrôle ABSOLU par table sentinelle (correction du 27.08.2026) ----------------------
# Ni ce contrôle-ci ni SEUIL_TAILLE_MIN_POURCENT plus bas ne se substituent l'un à l'autre — ils
# attrapent des défauts DIFFÉRENTS. SEUIL_TAILLE_MIN_POURCENT compare au fichier de la nuit
# PRÉCÉDENTE : sans référence (première sauvegarde) il ne peut RIEN attraper, et si une première
# sauvegarde anormalement petite passait quand même, TOUTES les suivantes s'y compareraient et le
# vide finirait par se valider lui-même comme normal. Ce contrôle-ci compare au contraire à une
# vérité ABSOLUE interrogée EN DIRECT sur la base source, jamais à un fichier antérieur : `public.
# tenant` est la table racine du modèle multi-tenant (RM-01) — dès qu'un premier garage est en
# production, elle n'est JAMAIS légitimement vide. Si la base source a des tenants mais que le
# CONTENU du dump n'en contient aucun (extrait directement du fichier produit, PAS une nouvelle
# requête réseau qui ne prouverait rien sur ce fichier précis), la sauvegarde est REJETÉE — peu
# importe que `pg_restore --list` l'ait jugée structurellement valide.
nb_tenants_source="$(PGPASSWORD="$PGPASSWORD" psql --host="$PGHOST" --port="$PGPORT" \
  --username="$PGUSER" --dbname="$PGDATABASE" -tAc "select count(*) from public.tenant;")"
if [ "$nb_tenants_source" -gt 0 ]; then
  # `pg_restore --data-only --table=tenant` réémet le `COPY ... FROM stdin; <lignes> \.` de cette
  # table depuis le fichier LOCAL déjà produit — aucune nouvelle requête, ce contrôle porte bien
  # sur ce que CE fichier contient, pas sur l'état de la base au moment du contrôle.
  nb_tenants_dump="$(pg_restore --data-only --table=tenant --file=- "$TMP" \
    | sed -n '/^COPY /,/^\\\.$/p' | grep -vc -E '^(COPY |\\\.$)')"
  if [ "$nb_tenants_dump" -eq 0 ]; then
    journaliser "ECHEC contrôle sentinelle : ${nb_tenants_source} tenant(s) en base source mais 0 dans le dump produit — sauvegarde REJETÉE (voir docs/exploitation-sauvegardes.md)"
    exit 1
  fi
  journaliser "contrôle sentinelle OK : ${nb_tenants_dump}/${nb_tenants_source} tenant(s) présents dans le dump"
fi

# --- 2. Rôles du cluster (même connexion superuser que ci-dessus) -------------------------------
PGPASSWORD="$PGPASSWORD" pg_dumpall --host="$PGHOST" --port="$PGPORT" \
  --username="$PGUSER" --database=postgres --roles-only --file="$TMP_ROLES"

# Vérification minimale (pas d'équivalent `pg_restore --list` pour un script SQL brut) : au moins
# une instruction CREATE ROLE, et les trois rôles applicatifs nommément présents — sinon le dump
# de rôles est vide/tronqué (ex. connexion superuser refusée en silence par une mauvaise
# configuration `pg_hba.conf`, hypothèse déjà vue en développement) et REJETÉ plutôt que conservé,
# même logique que le seuil de taille du dump principal plus bas.
if ! grep -q '^CREATE ROLE ' "$TMP_ROLES"; then
  journaliser "ECHEC dump de rôles vide ou invalide (aucun CREATE ROLE trouvé) — sauvegarde REJETÉE"
  exit 1
fi
# Format réel observé (pg_dumpall 16, vérifié en exécution) : « CREATE ROLE dfa_migrator; » — le
# nom du rôle est suivi directement du `;`, jamais d'espace ni de guillemets pour un identifiant
# sans caractère spécial. `[;[:space:]]` couvre aussi une éventuelle variante avec clause `WITH`
# sur la même ligne, jamais supposé sans avoir vérifié le format réel une première fois.
for role_attendu in dfa_migrator dfa_app; do
  if ! grep -qE "^CREATE ROLE ${role_attendu}[;[:space:]]" "$TMP_ROLES"; then
    journaliser "ECHEC dump de rôles incomplet : '${role_attendu}' absent — sauvegarde REJETÉE"
    exit 1
  fi
done

# --- 3. Chiffrement des deux dumps (destinataire réel + destinataire de test optionnel) --------
DESTINATAIRES=(-r "$AGE_CLE_PUBLIQUE")
if [ -n "${AGE_CLE_PUBLIQUE_TEST:-}" ]; then
  DESTINATAIRES+=(-r "$AGE_CLE_PUBLIQUE_TEST")
fi
age "${DESTINATAIRES[@]}" -o "$FICHIER_FINAL" "$TMP"
age "${DESTINATAIRES[@]}" -o "$FICHIER_ROLES_FINAL" "$TMP_ROLES"

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
      rm -f -- "$FICHIER_FINAL" "$FICHIER_ROLES_FINAL"
      echo "ECHEC $(date -Iseconds)" >"$STATUT"
      exit 1
    fi
  fi
fi

journaliser "OK sauvegarde $(basename "$FICHIER_FINAL") (${taille_octets} octets) + $(basename "$FICHIER_ROLES_FINAL")"

"$(dirname "${BASH_SOURCE[0]}")/purger.sh" "$SAUVEGARDES_DIR"

echo "OK $(date -Iseconds)" >"$STATUT"

# --- 4. Copie hors site (NON BLOQUANTE — voir copier-hors-site.sh) ------------------------------
# Un échec de copie hors site ne doit JAMAIS faire passer LA SAUVEGARDE LOCALE (déjà réussie et
# consignée ci-dessus, statut déjà écrit) pour un échec — le statut local et le statut hors site
# sont deux faits distincts, dans deux fichiers distincts (voir copier-hors-site.sh), pour ne
# jamais masquer l'un derrière l'autre. `|| true` explicite : ce script continue (et sort 0) même
# si la copie hors site échoue bruyamment dans SON PROPRE journal/statut.
if ! "$(dirname "${BASH_SOURCE[0]}")/copier-hors-site.sh" "$SAUVEGARDES_DIR" "$(basename "$FICHIER_FINAL")" "$(basename "$FICHIER_ROLES_FINAL")"; then
  journaliser "ATTENTION copie hors site échouée ou non configurée — voir dernier-statut-hors-site.txt"
fi
