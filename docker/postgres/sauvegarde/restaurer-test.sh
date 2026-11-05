#!/usr/bin/env bash
# =================================================================================================
# restaurer-test.sh — restauration COMPLÈTE (rôles + schéma + données) sur une instance PostgreSQL
# JETABLE, entièrement auto-contenue dans CE conteneur (initdb/pg_ctl locaux — voir « POURQUOI PAS
# DOCKER » ci-dessous), pour prouver qu'une sauvegarde est effectivement restaurable — « une
# sauvegarde non testée n'existe pas ».
#
# RÉÉCRIT le 27.08.2026 (deux changements de fond, pas une retouche cosmétique) :
#
#   1. RÔLES RESTAURÉS AVANT LES DONNÉES, PLUS DE `--no-owner`. La version précédente restaurait
#      dans un Postgres jetable démarré avec un simple mot de passe superuser et `pg_restore
#      --no-owner` — ça prouvait que le DUMP n'était pas corrompu, JAMAIS que dfa_app/dfa_migrator
#      existent et que le RLS s'applique à eux. Ce script décrypte et rejoue D'ABORD le dump de
#      rôles produit par sauvegarder.sh (`pg_dumpall --roles-only`), PUIS restaure le dump
#      schéma+données EN TANT QUE dfa_migrator (jamais un superuser générique), PUIS vérifie le RLS
#      EN TANT QUE dfa_app (jamais bypassé) — voir « VÉRIFICATIONS » plus bas. C'est la seule façon
#      de prouver « rôles compris » plutôt que de l'affirmer.
#
#   2. POURQUOI PAS DOCKER (le `docker run`/`docker exec` de l'ancienne version a disparu) : ce
#      script doit pouvoir tourner SEUL, AUTOMATIQUEMENT, chaque mois, depuis un conteneur dédié
#      (voir planifier-test.sh) — lui donner accès au socket Docker de l'hôte
#      (`/var/run/docker.sock`) pour qu'il puisse lancer `docker run` reviendrait à lui donner un
#      accès ÉQUIVALENT AU ROOT DE L'HÔTE (le socket Docker ne connaît pas de mode « lecture
#      seule » utile : quiconque peut y écrire peut démarrer un conteneur privilégié et sortir du
#      confinement) — inacceptable pour un job qui tourne sans supervision humaine chaque mois.
#      L'image de ce service est DÉJÀ construite sur `postgres:16-alpine` (voir le Dockerfile —
#      c'est la même raison qui l'a fait choisir pour `sauvegarder.sh` : version majeure IDENTIQUE
#      à la production) et embarque donc DÉJÀ les binaires serveur (`initdb`, `pg_ctl`) en plus des
#      outils client. Ce script les utilise pour démarrer un Postgres complet, LOCAL À CE
#      CONTENEUR, sur un `PGDATA` et un socket Unix JETABLES (jamais sur le volume persistant, pas
#      de port TCP publié) — zéro privilège supplémentaire, zéro dépendance au démon Docker de
#      l'hôte.
#
# À NE PAS CONFONDRE avec restaurer.sh (à côté de ce fichier) : celui-ci ne touche JAMAIS
# dfa_dev/dfa_test/dfa ni le Postgres de production — tout se passe dans une instance jetable,
# détruite en fin d'exécution quoi qu'il arrive (voir le `trap` ci-dessous).
#
# Usage :
#   restaurer-test.sh <dump-donnees.dump.age> <dump-roles.roles.sql.age>
#
# Variable requise :
#   AGE_CLE_PRIVEE_FICHIER   chemin vers UNE clé privée age qui déchiffre les deux fichiers — soit
#                            la clé RÉELLE (usage manuel, apportée pour l'occasion, jamais laissée
#                            sur ce serveur — même règle que restaurer.sh), soit la clé de TEST
#                            dédiée (usage automatisé mensuel, voir planifier-test.sh et
#                            the backup documentation, "test key") — ce script ne fait
#                            aucune différence entre les deux, `age -d` déchiffre avec n'importe
#                            quelle clé privée correspondant à un des destinataires du fichier.
# =================================================================================================
set -euo pipefail

FICHIER_DONNEES="${1:?Usage: restaurer-test.sh <dump-donnees.dump.age> <dump-roles.roles.sql.age>}"
FICHIER_ROLES="${2:?Usage: restaurer-test.sh <dump-donnees.dump.age> <dump-roles.roles.sql.age>}"

for f in "$FICHIER_DONNEES" "$FICHIER_ROLES"; do
  if [ ! -r "$f" ]; then
    echo "Introuvable ou illisible : $f" >&2
    exit 1
  fi
done

: "${AGE_CLE_PRIVEE_FICHIER:?AGE_CLE_PRIVEE_FICHIER manquant — clé privée age (réelle ou de test, voir en-tête)}"
if [ ! -r "$AGE_CLE_PRIVEE_FICHIER" ]; then
  echo "Erreur : clé privée age introuvable ou illisible : ${AGE_CLE_PRIVEE_FICHIER}" >&2
  exit 1
fi

RACINE_JETABLE="$(mktemp -d)"
PGDATA="$RACINE_JETABLE/pgdata"
SOCKET_DIR="$RACINE_JETABLE/socket"
JOURNAL_SERVEUR="$RACINE_JETABLE/serveur.log"
mkdir -p "$SOCKET_DIR"

SERVEUR_DEMARRE=0

# Nettoyage systématique — instance Postgres arrêtée PUIS répertoire jetable entier supprimé, quoi
# qu'il arrive (succès, échec à n'importe quelle étape, script tué). Rien de ce script ne doit
# survivre à son exécution : ni le serveur jetable, ni les dumps déchiffrés en clair (écrits
# uniquement sous $RACINE_JETABLE, jamais ailleurs).
nettoyer() {
  local code=$?
  if [ "$SERVEUR_DEMARRE" -eq 1 ]; then
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$RACINE_JETABLE"
  exit "$code"
}
trap nettoyer EXIT

echo "→ [1/6] Initialisation d'une instance PostgreSQL jetable (initdb, même binaire que la production)..."
# --auth-local=trust --auth-host=trust : cette instance n'existe que le temps de ce script, sur un
# socket Unix privé à CE processus (permissions du répertoire = utilisateur courant uniquement,
# comportement par défaut d'initdb) — aucune raison d'exiger un mot de passe pour s'y connecter, y
# compris sous le nom des rôles applicatifs restaurés juste après (dont on ne connaît, à dessein,
# jamais le mot de passe en clair — seule l'empreinte a été restaurée, voir [3/6]).
initdb --username=postgres --auth-local=trust --auth-host=trust --pgdata="$PGDATA" >"$JOURNAL_SERVEUR" 2>&1

echo "→ [2/6] Démarrage (socket Unix uniquement, aucun port TCP publié)..."
pg_ctl -D "$PGDATA" -l "$JOURNAL_SERVEUR" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='${SOCKET_DIR}'" start
SERVEUR_DEMARRE=1

PSQL_SUPERUSER=(psql -h "$SOCKET_DIR" -U postgres -v ON_ERROR_STOP=1 -tA)

echo "→ [3/6] Déchiffrement et rejeu du dump de RÔLES (clé privée fournie)..."
age -d -i "$AGE_CLE_PRIVEE_FICHIER" "$FICHIER_ROLES" > "$RACINE_JETABLE/roles.sql"
"${PSQL_SUPERUSER[@]}" -d postgres -f "$RACINE_JETABLE/roles.sql" >/dev/null

for role_attendu in dfa_migrator dfa_app; do
  existe="$("${PSQL_SUPERUSER[@]}" -d postgres -c "select 1 from pg_roles where rolname = '${role_attendu}';")"
  if [ "$existe" != "1" ]; then
    echo "ÉCHEC : le rôle '${role_attendu}' n'existe pas après rejeu du dump de rôles — restauration invalide." >&2
    exit 1
  fi
done

echo "→ [4/6] Création de la base cible (propriétaire dfa_migrator, comme en production)..."
"${PSQL_SUPERUSER[@]}" -d postgres -c "create database restauration_test owner dfa_migrator;" >/dev/null

echo "→ [5/6] Déchiffrement et restauration du dump schéma+données, EN TANT QUE dfa_migrator (jamais --no-owner, jamais le superuser)..."
age -d -i "$AGE_CLE_PRIVEE_FICHIER" "$FICHIER_DONNEES" \
  | pg_restore -h "$SOCKET_DIR" -U dfa_migrator -d restauration_test

echo "→ [6/6] Vérifications — SUR LES VRAIS RÔLES RESTAURÉS, pas sur le superuser jetable :"

nb_tables="$("${PSQL_SUPERUSER[@]}" -d restauration_test -c "select count(*) from information_schema.tables where table_schema = 'public';")"
echo "  Tables du schéma public : ${nb_tables}"
if [ "$nb_tables" -eq 0 ]; then
  echo "ÉCHEC : aucune table restaurée." >&2
  exit 1
fi

# INFORMATIF, PAS UNE CONDITION D'ÉCHEC (correction du 27.08.2026, sur constat en exécution) :
# une version antérieure de ce script exigeait 0 ici — FAUX en pratique, vérifié contre le Postgres
# de développement réel : `type_approbation_ch`, `type_approbation_ch_marque_alias` et
# `referentiel_vehicules_ch_etat_import` (référentiel véhicules suisse ASTRA, migration 0050) sont
# des tables de RÉFÉRENCE PARTAGÉES, délibérément SANS RLS (aucune notion de tenant n'a de sens
# pour un référentiel national commun à tous les garages) — un décompte non nul ici est donc
# NORMAL et attendu, pas un défaut de restauration. Conservé à titre d'INFORMATION (un futur ajout
# de table métier oubliant son RLS resterait visible ici, à l'œil, dans le journal), mais ne fait
# plus échouer ce script — le VRAI test d'isolation, behavioral et non déclaratif, est ci-dessous
# (dfa_app sans/avec contexte tenant).
nb_sans_rls="$("${PSQL_SUPERUSER[@]}" -d restauration_test -c "select count(*) from pg_tables where schemaname = 'public' and rowsecurity = false;")"
echo "  Tables du schéma public sans RLS activé (information — tables de référence partagées type ASTRA attendues) : ${nb_sans_rls}"
if [ "$nb_sans_rls" -gt 0 ]; then
  "${PSQL_SUPERUSER[@]}" -d restauration_test -c "select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by tablename;"     | sed 's/^/    - /'
fi

nb_tenants_superuser="$("${PSQL_SUPERUSER[@]}" -d restauration_test -c "select count(*) from public.tenant;")"
echo "  Tenants visibles en superuser (contourne le RLS, sert de témoin — attendu > 0 si la sauvegarde source avait des données) : ${nb_tenants_superuser}"

# LE VRAI TEST « RÔLES COMPRIS » : dfa_app, restauré depuis le dump de rôles (pas le superuser
# jetable), SANS contexte de tenant posé (app.tenant_id jamais défini dans cette session) — RLS
# doit masquer TOUTE ligne. `-h` (socket) + `--auth-local=trust` : connexion sous ce nom de rôle
# sans en connaître le mot de passe réel, voir [1/6]. Un résultat non nul ici signifierait que le
# RLS restauré ne protège plus rien — la panne de sécurité la plus grave que ce test puisse
# détecter, donc vérifiée explicitement plutôt que supposée acquise par la présence des rôles.
nb_tenants_dfa_app="$(psql -h "$SOCKET_DIR" -U dfa_app -v ON_ERROR_STOP=1 -tA -d restauration_test -c "select count(*) from public.tenant;")"
echo "  Tenants visibles en dfa_app SANS contexte tenant posé (0 attendu — RLS doit tout masquer) : ${nb_tenants_dfa_app}"
if [ "$nb_tenants_dfa_app" -ne 0 ]; then
  echo "ÉCHEC : dfa_app voit des lignes sans contexte tenant posé — RLS non appliqué après restauration des rôles." >&2
  exit 1
fi

if [ "$nb_tenants_superuser" -gt 0 ]; then
  echo "  Isolation croisée (RLS scope réellement sur UN tenant, pas 0 partout par accident) :"
  premier_tenant="$("${PSQL_SUPERUSER[@]}" -d restauration_test -c "select id from public.tenant order by id limit 1;")"
  nb_scope="$(psql -h "$SOCKET_DIR" -U dfa_app -v ON_ERROR_STOP=1 -tA -d restauration_test \
    -c "select set_config('app.tenant_id', '${premier_tenant}', false);" \
    -c "select count(*) from public.tenant;" | tail -n1)"
  echo "    Tenants visibles en dfa_app avec app.tenant_id posé sur UN tenant réel (1 attendu) : ${nb_scope}"
  if [ "$nb_scope" -ne 1 ]; then
    echo "ÉCHEC : dfa_app avec un contexte tenant valide ne voit pas exactement 1 tenant (RLS scope incorrect)." >&2
    exit 1
  fi
fi

echo ""
echo "OK. Restauration complète (rôles + schéma + données) réussie et vérifiée depuis :"
echo "  - $(basename "$FICHIER_DONNEES")"
echo "  - $(basename "$FICHIER_ROLES")"
echo ""
echo "RAPPEL : consigner la date et le résultat de CETTE exécution quelque part de durable"
echo "(changelog interne, ticket) si ce test a été lancé À LA MAIN — l'exécution automatisée"
echo "mensuelle (planifier-test.sh) écrit déjà /sauvegardes/dernier-statut-restauration-test.txt."
