#!/usr/bin/env bash
# =================================================================================================
# verifier-reversibilite-migrations.sh — preuve mécanique que chaque migration est réversible.
#
# Automatise le protocole qui s'était stabilisé à la main sur ce dépôt pour les migrations 0012 à
# 0018 (et qui a réellement trouvé quelque chose : un `comment on table` que le down de 0012 ne
# restaurait pas mot pour mot, alors que `verifierPostureRls()` lit ce commentaire au démarrage) :
#
#   1. appliquer la migration montante ;
#   2. dump schéma (`pg_dump --schema-only`) ;
#   3. appliquer la migration inverse (migrations/down/<nom>.down.sql) ;
#   4. dump schéma ;
#   5. réappliquer la montante ;
#   6. dump schéma ;
#   7. comparer : le dump après (montante, down, montante) doit être IDENTIQUE au dump après la
#      première application, ET le dump après le down seul doit être IDENTIQUE au dump d'AVANT
#      la migration (le down doit annuler exactement, pas « à peu près »).
#
# GRANULARITÉ (arbitrage demandé) : chaque migration est testée INDIVIDUELLEMENT, dans l'ordre où
# elle a réellement été appliquée en production (0000 d'abord, puis 0001 sur le schéma qui en
# résulte, etc. — jamais une migration isolée sur une base vierge). Une régression nomme SA
# migration fautive immédiatement ; l'alternative (un seul cycle « up all → down all → up all »)
# est plus rapide mais rendrait un diagnostic sur 19 migrations à la fois inexploitable. Le coût
# est linéaire en nombre de migrations (chaque migration est appliquée une fois pour construire la
# chaîne, testée une fois en aller-retour) — pas quadratique : on ne rejoue jamais depuis zéro pour
# chacune.
#
# PÉRIMÈTRE (arbitrage demandé) : TOUTES les migrations existantes sont rejouées à chaque
# exécution, pas seulement celles ajoutées par la branche. Un diff-only manquerait exactement le
# scénario qui a motivé ce script : une migration ANCIENNE dont le down casse parce qu'une
# migration PLUS RÉCENTE a changé une hypothèse qu'il tenait pour acquise (colonne renommée,
# contrainte durcie, commentaire réécrit) — c'est un down qui pourrissait en silence, découvert
# uniquement le jour où il faudrait vraiment revenir en arrière. Tant que le nombre de migrations
# reste dans la centaine basse, le coût mesuré (voir le run réel documenté dans le commit qui
# introduit ce script) reste très inférieur à celui de `tests-integration` dans le même workflow ;
# si ce coût devient un jour dominant, la prochaine étape est de ne rejouer l'historique complet
# que sur `main` (post-merge) et de limiter les PR au diff — pas avant, complexité non justifiée
# aujourd'hui.
#
# CE QUE CE GARDE-FOU NE DÉTECTE PAS (à lire avant de s'y fier aveuglément) :
#   - Aucune donnée : chaque migration tourne sur un schéma VIDE de données métier. Un `down` qui
#     réussirait à restaurer le schéma exact mais perdrait ou corromprait des lignes existantes
#     (typiquement une migration avec backfill) n'est PAS mis en défaut ici — `pg_dump
#     --schema-only` ne compare que la structure, jamais le contenu des tables.
#   - Aucun volume réel ni verrou de production : un `ALTER TABLE` qui verrouille une grosse table
#     pendant de longues secondes en production est instantané ici (tables vides). La réversibilité
#     structurelle est prouvée, pas l'innocuité opérationnelle d'un rollback sous charge.
#   - Un rollback de PLUSIEURS migrations d'un coup (down N, puis down N-1 sans réappliquer entre
#     les deux) : seul un aller-retour À UN SEUL CRAN (down puis remontée immédiate) est testé par
#     migration. Un empilement de « down » consécutifs n'est jamais exercé tel quel.
#   - Les migrations exécutées en parallèle par deux instances (le verrou consultatif de
#     `migrer.ts` n'est pas sollicité ici, une seule connexion opère du début à la fin).
#
# `migrer.ts` (apps/api/src/db/migrer.ts, hors périmètre de ce script) n'a AUCUN mécanisme de
# `down` automatisé : ce script applique donc les fichiers `down/*.sql` directement au pilote SQL,
# et retire la ligne de suivi correspondante de `__dfa_migrations` à la main — exactement ce que
# les agents ont fait manuellement jusqu'ici. Une vraie recommandation, à trancher par @laupernoe : donner
# à `migrer.ts` un chemin `down` connu (au minimum : appliquer un fichier down + retirer la ligne
# de suivi dans LA MÊME transaction, ce que ce script ne fait pas — un down qui échoue à mi-chemin
# ici peut laisser une base dans un état intermédiaire, rattrapable seulement parce que la base est
# éphémère et jetée en fin de script).
#
# ENVIRONNEMENT REQUIS SUR L'EXÉCUTANT : uniquement `docker` et `pnpm` (+ Node, via pnpm) sur le
# PATH. AUCUN psql/pg_dump n'est requis sur l'hôte : ce script démarre son PROPRE conteneur
# Postgres jetable et route CHAQUE commande SQL via `docker exec` dans ce conteneur — les outils
# clients utilisés sont donc TOUJOURS exactement ceux embarqués dans l'image serveur
# (postgres:16-alpine, alignée sur docker-compose.yml), jamais une version dépareillée installée
# sur le runner.
#
# ISOLATION : ce script ne touche JAMAIS `dfa_dev` (le conteneur `dfa-postgres` existant, le jeu de
# démo). Il démarre un conteneur Postgres et un réseau Docker entièrement séparés, nommés avec un
# suffixe unique (PID), détruits en fin d'exécution (trap EXIT) — succès, échec ou interruption.
#
# USAGE :
#   scripts/verifier-reversibilite-migrations.sh
#
# VARIABLES D'ENVIRONNEMENT (toutes optionnelles) :
#   DFA_VERIF_PG_HOTE_DEPUIS_PNPM   Hôte utilisé par `pnpm db:migrate` pour joindre le Postgres
#                                   éphémère (dont le port est publié sur l'hôte Docker).
#                                   Défaut '127.0.0.1' — correct quand pnpm tourne NATIVEMENT sur
#                                   le même hôte que le démon Docker (le cas en CI). À positionner
#                                   à 'host.docker.internal' si `pnpm` tourne lui-même DANS un
#                                   conteneur (cas d'un hôte sans Node — voir le README, section
#                                   « Dev sans Node ni pnpm sur l'hôte », même contrainte).
#   DFA_VERIF_GARDER_CONTENEURS    Si non vide, ne détruit pas le conteneur/réseau en fin de
#                                   script (diagnostic manuel après un échec).
#   DFA_VERIF_RACINE_HOTE           Chemin du dépôt tel que VU PAR LE DÉMON DOCKER, pour le seul
#                                   montage `-v` du Postgres éphémère (01-roles.sql). Défaut : le
#                                   chemin calculé par ce script. À positionner explicitement quand
#                                   ce script tourne LUI-MÊME dans un conteneur qui parle au démon
#                                   Docker de l'hôte (Docker-outside-of-Docker, socket monté) : le
#                                   démon ne connaît que les chemins de l'hôte réel, jamais ceux du
#                                   conteneur appelant.
# =================================================================================================

set -euo pipefail

# --- Garde de portabilité : ce script doit tourner sous bash 3.2 (défaut sur macOS, la machine de
# développement de @laupernoe) SANS invocation particulière. Toute la suite du script est écrite pour
# rester compatible bash 3.2 (aucun tableau associatif, aucun `mapfile`, aucun index négatif de
# tableau — ces trois constructions n'existent qu'à partir de bash 4). Cette garde ne sert donc
# QUE de filet pour un interpréteur encore plus ancien/différent (ex. lancé par erreur via `sh` :
# `BASH_VERSION` y est alors absent) : un refus explicite qui dit quoi faire vaut mieux qu'un
# échec obscur au milieu du script (`declare: not found`, `[: -eq: unary operator expected`, etc.
# — c'est exactement ce qui s'est produit avant ce correctif).
if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "ÉCHEC : ce script doit être exécuté par bash, pas par sh/dash. Lancez-le en" >&2
  echo "        './scripts/verifier-reversibilite-migrations.sh' ou 'bash scripts/verifier-reversibilite-migrations.sh'." >&2
  exit 1
fi
if [[ "${BASH_VERSINFO[0]}" -lt 3 ]]; then
  echo "ÉCHEC : bash ${BASH_VERSION} détecté, ce script requiert au moins bash 3.2." >&2
  echo "        macOS : bash système (/bin/bash) convient déjà. Sinon : brew install bash." >&2
  exit 1
fi

RACINE_DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPERTOIRE_MIGRATIONS="$RACINE_DEPOT/apps/api/src/db/migrations"
REPERTOIRE_DOWN="$REPERTOIRE_MIGRATIONS/down"

readonly SUFFIXE="$$"
readonly NOM_RESEAU="dfa-verif-net-${SUFFIXE}"
readonly NOM_CONTENEUR_PG="dfa-verif-pg-${SUFFIXE}"
readonly BASE_EPHEMERE="dfa_verif_reversibilite"
readonly SUPERUSER_PG="dfa_verif"
readonly SUPERUSER_MDP_PG="dfa_verif_mdp_ephemere"
readonly ROLE_MIGRATOR="dfa_migrator"
readonly MDP_MIGRATOR="dfa_migrator_dev" # posé par docker/postgres/init/01-roles.sql, pas un secret prod.
readonly HOTE_PNPM="${DFA_VERIF_PG_HOTE_DEPUIS_PNPM:-127.0.0.1}"
readonly RACINE_DEPOT_POUR_DOCKER="${DFA_VERIF_RACINE_HOTE:-$RACINE_DEPOT}"

REPERTOIRE_TRAVAIL="$(mktemp -d "${TMPDIR:-/tmp}/dfa-verif-migrations.XXXXXX")"
PORT_PUBLIE=""
DEBUT_GLOBAL=$(date +%s)

journaliser() { printf '%s\n' "$*" >&2; }

nettoyer() {
  if [[ -n "${DFA_VERIF_GARDER_CONTENEURS:-}" ]]; then
    journaliser "DFA_VERIF_GARDER_CONTENEURS positionné : conteneur ${NOM_CONTENEUR_PG} et réseau ${NOM_RESEAU} conservés."
    return
  fi
  docker rm -f "$NOM_CONTENEUR_PG" >/dev/null 2>&1 || true
  docker network rm "$NOM_RESEAU" >/dev/null 2>&1 || true
  rm -rf "$REPERTOIRE_TRAVAIL"
}
trap nettoyer EXIT

# --- Démarrage du Postgres éphémère -------------------------------------------------------------
# Même mécanisme que docker-compose.yml (dev) et docker-compose.yml : POSTGRES_DB déclenche
# la création de la base au tout premier démarrage, et le fichier monté dans
# /docker-entrypoint-initdb.d/ (le VRAI docker/postgres/init/01-roles.sql du dépôt, pas une copie)
# tourne automatiquement dessus — mêmes rôles, mêmes GRANT, aucune divergence avec dev/prod.
journaliser "Démarrage du Postgres éphémère (${NOM_CONTENEUR_PG})…"
docker network create "$NOM_RESEAU" >/dev/null

# Trouve un port hôte FIXE libre (nécessaire pour Docker rootless qui ne supporte pas les
# ports éphémères mappés). Boucle sur la plage 25432–25442 et teste la disponibilité côté
# hôte avec bash /dev/tcp. Prend le premier libre.
PORT_PUBLIE=""
for port_candidate in $(seq 25432 25442); do
  if ! (exec 3<>/dev/tcp/127.0.0.1/"$port_candidate") 2>/dev/null; then
    PORT_PUBLIE="$port_candidate"
    break
  fi
done
if [[ -z "$PORT_PUBLIE" ]]; then
  journaliser "ÉCHEC : aucun port libre trouvé dans la plage 25432–25442."
  exit 1
fi

docker run -d \
  --name "$NOM_CONTENEUR_PG" \
  --network "$NOM_RESEAU" \
  -p "${PORT_PUBLIE}:5432" \
  -e POSTGRES_USER="$SUPERUSER_PG" \
  -e POSTGRES_PASSWORD="$SUPERUSER_MDP_PG" \
  -e POSTGRES_DB="$BASE_EPHEMERE" \
  -e POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C.UTF-8" \
  -v "$RACINE_DEPOT_POUR_DOCKER/docker/postgres/init/01-roles.sql:/docker-entrypoint-initdb.d/01-roles.sql:ro" \
  postgres:16-alpine >/dev/null

# Sonde que Postgres répond réellement. L'image postgres officielle démarre d'abord un
# serveur temporaire (phase initdb), puis le serveur final. On teste en forçant TCP
# (-h 127.0.0.1 -p 5432) DANS le conteneur pour confirmer que Postgres répond vraiment,
# pas juste que la socket Unix existe. Demande 2 succès consécutifs (espacés d'1s) pour
# ignorer les faux positifs (fenêtres où seul le serveur temporaire est actif).
DEBUT_READINESS=$(date +%s)
SUCCES_CONSECUTIFS=0
for i in $(seq 1 120); do
  # pg_isready -h 127.0.0.1 -p 5432 force TCP dans le conteneur — teste si Postgres
  # répond réellement au protocole Postgres. Le rôle SUPERUSER_PG est créé par 01-roles.sql
  # au démarrage, donc cette commande réussit seulement quand Postgres est ENTIÈREMENT
  # prêt (phase initdb complète, serveur final en marche).
  if docker exec "$NOM_CONTENEUR_PG" pg_isready -h 127.0.0.1 -p 5432 -U "$SUPERUSER_PG" -d "$BASE_EPHEMERE" >/dev/null 2>&1; then
    SUCCES_CONSECUTIFS=$(( SUCCES_CONSECUTIFS + 1 ))
    if [[ $SUCCES_CONSECUTIFS -ge 2 ]]; then
      break
    fi
  else
    SUCCES_CONSECUTIFS=0
  fi
  sleep 1
done
DUREE_READINESS=$(( $(date +%s) - DEBUT_READINESS ))
if [[ $SUCCES_CONSECUTIFS -lt 2 ]]; then
  journaliser "ÉCHEC : le Postgres éphémère n'est jamais devenu prêt (${DUREE_READINESS}s d'attente)."
  docker logs "$NOM_CONTENEUR_PG" >&2 || true
  exit 1
fi

# Vérifie une dernière fois que le port publié fixe fonctionne vraiment (la connexion TCP
# depuis l'hôte — c'est celle que pnpm utilisera). Demande 2 succès consécutifs (espacés
# d'1s) pour confirmer. Timeout court (≤15s) : si pg_isready a réussi, TCP depuis l'hôte
# devrait fonctionner immédiatement avec un port fixe.
SUCCES_TCP_HOTE=0
for i in $(seq 1 15); do
  if (exec 3<>/dev/tcp/127.0.0.1/"$PORT_PUBLIE") 2>/dev/null; then
    SUCCES_TCP_HOTE=$(( SUCCES_TCP_HOTE + 1 ))
    if [[ $SUCCES_TCP_HOTE -ge 2 ]]; then
      break
    fi
  else
    SUCCES_TCP_HOTE=0
  fi
  sleep 1
done
if [[ $SUCCES_TCP_HOTE -lt 2 ]]; then
  journaliser "ÉCHEC : le port publié 127.0.0.1:${PORT_PUBLIE} n'a jamais répondu en TCP."
  exit 1
fi

journaliser "Postgres éphémère prêt sur 127.0.0.1:${PORT_PUBLIE} (conteneur ${NOM_CONTENEUR_PG})."

export NODE_ENV=test
export API_URL_PUBLIQUE="http://localhost:3000"
export WEB_URL_PUBLIQUE="http://localhost:5173"
export REDIS_URL="redis://localhost:6379"
# Jamais utilisée pour une vraie connexion (migrer.ts ne lit que DATABASE_URL_MIGRATION) : sert
# uniquement à satisfaire `DATABASE_URL !== DATABASE_URL_MIGRATION` dans le schéma zod.
export DATABASE_URL="postgresql://dfa_app:dfa_app_dev@${HOTE_PNPM}:${PORT_PUBLIE}/${BASE_EPHEMERE}_jamais_utilisee"
export DATABASE_URL_MIGRATION="postgresql://${ROLE_MIGRATOR}:${MDP_MIGRATOR}@${HOTE_PNPM}:${PORT_PUBLIE}/${BASE_EPHEMERE}"

# --- Fonctions SQL : tout passe par `docker exec` dans le conteneur Postgres --------------------

# `pg_dump` insère un jeton `\restrict`/`\unrestrict` ALÉATOIRE à chaque exécution (mécanisme de
# restriction récent de psql) : seul écart légitime à neutraliser avant comparaison, rien d'autre.
dump_schema() {
  local fichier_sortie="$1"
  docker exec -e PGPASSWORD="$MDP_MIGRATOR" "$NOM_CONTENEUR_PG" \
    pg_dump -U "$ROLE_MIGRATOR" -d "$BASE_EPHEMERE" --schema-only \
    | sed -E 's/^\\(un)?restrict [A-Za-z0-9]+$/\\\1restrict JETON_NORMALISE/' \
    > "$fichier_sortie"
}

appliquer_sql_fichier() {
  local fichier="$1"
  docker exec -i -e PGPASSWORD="$MDP_MIGRATOR" "$NOM_CONTENEUR_PG" \
    psql -v ON_ERROR_STOP=1 -q -U "$ROLE_MIGRATOR" -d "$BASE_EPHEMERE" \
    < "$fichier"
}

retirer_suivi_migration() {
  local nom_fichier="$1"
  docker exec -e PGPASSWORD="$MDP_MIGRATOR" "$NOM_CONTENEUR_PG" \
    psql -v ON_ERROR_STOP=1 -q -U "$ROLE_MIGRATOR" -d "$BASE_EPHEMERE" \
    -c "delete from public.__dfa_migrations where nom = '${nom_fichier}';"
}

appliquer_migrations_montantes() {
  # `pnpm db:migrate` (la CLI de migrer.ts) applique TOUT ce qui est en attente dans SON
  # répertoire par défaut — impossible d'en appliquer une seule à la fois par ce chemin. On passe
  # donc par la fonction exportée `appliquerMigrations` (documentée « usage programme » dans
  # migrer.ts, déjà le point d'entrée des tests d'intégration), sur un répertoire de travail
  # (REPERTOIRE_PROGRESSIF) qui ne contient QUE les migrations déjà « révélées » par la boucle —
  # jamais apps/api/src/db/migrations/ directement. Aide dans scripts/appliquer-migrations-increment.ts.
  (cd "$RACINE_DEPOT" && pnpm --filter @dfa/api exec tsx "$RACINE_DEPOT/scripts/appliquer-migrations-increment.ts" "$REPERTOIRE_PROGRESSIF" \
    >"$REPERTOIRE_TRAVAIL/derniere-migration.log" 2>&1) \
    || { journaliser "ÉCHEC de l'application de la migration montante — sortie :"; cat "$REPERTOIRE_TRAVAIL/derniere-migration.log" >&2; return 1; }
}

# --- Exceptions documentées au « down doit restaurer EXACTEMENT l'état d'avant » -----------------
#
# Ne dispense JAMAIS des deux autres vérifications (le down doit s'exécuter sans erreur SQL, et la
# migration doit se réappliquer à l'identique après son propre down) — seulement de la comparaison
# stricte « avant migration == après down ». Chaque entrée doit citer la limite réelle qui la
# justifie ; le texte ci-dessous n'est pas une nouvelle source de vérité, il reprend l'en-tête déjà
# écrit dans le fichier down/*.sql correspondant (hors périmètre de ce script), qu'il vaut la peine
# de relire si cette liste s'allonge un jour.
#
# 0010_facturation.sql : `alter type public.entite_auditee add value if not exists 'X'` (6 fois,
# §2 de la migration). PostgreSQL n'offre AUCUN « DROP VALUE » sur un type enum, seulement une
# recréation complète du type — jugée par l'auteur de la migration plus risquée que le résidu
# qu'elle corrigerait (voir l'en-tête de down/0010_facturation.down.sql). Le `IF NOT EXISTS` côté
# montante est délibéré et documenté comme préparé POUR CE CYCLE up→down→up précisément : sans lui,
# la réapplication échouerait dès le second `up` — c'est justement la vérification qui SUIT cette
# exception (down+remontée == première montante) qui reste, elle, pleinement exigée.
# Même limite, même schéma de preuve, une seule valeur cette fois : voir l'en-tête de
# down/0016_audit_tenant_bloc_creancier.down.sql (identique dans son raisonnement à 0010).
#
# Étape 3 (pièces) : QUATRE nouvelles entrées, même limite, chacune une seule valeur ajoutée à
# entite_auditee — vérifié en exécution (protocole manuel équivalent à ce script, pnpm/node
# absents de l'hôte qui a écrit ces migrations ; voir le rapport de livraison de
# expert-database) : down sans erreur SQL, remontée après down identique à la première montante,
# et le SEUL diff résiduel avant/après down est exactement la ligne de la valeur enum ajoutée —
# rien d'autre ne fuit.
# Portabilité bash 3.2 (voir la garde en tête de script) : pas de tableau associatif (`declare -A`
# n'existe qu'à partir de bash 4). `obtenir_exception_down_partiel <fichier_montant>` imprime le
# message sur stdout et rend 0 s'il existe une exception documentée pour ce fichier, rend 1 sans
# rien imprimer sinon — mêmes entrées, même contenu que le tableau associatif remplacé.
obtenir_exception_down_partiel() {
  case "$1" in
    "0010_facturation.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 6 valeurs — PostgreSQL n'a pas de DROP VALUE ; voir l'en-tête de down/0010_facturation.down.sql." ;;
    "0016_audit_tenant_bloc_creancier.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (tenant_bloc_creancier) — même limite que 0010 ; voir l'en-tête de down/0016_audit_tenant_bloc_creancier.down.sql." ;;
    "0022_pieces_referentiel.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (article) — même limite que 0010 ; voir l'en-tête de down/0022_pieces_referentiel.down.sql." ;;
    "0023_pieces_entite_auditee_commande_fournisseur.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (commande_fournisseur) — même limite que 0010 ; voir l'en-tête de down/0023_pieces_entite_auditee_commande_fournisseur.down.sql (down intentionnellement vide, rien d'autre à défaire)." ;;
    "0025_pieces_stock_mouvements.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (mouvement_stock) — même limite que 0010 ; voir l'en-tête de down/0025_pieces_stock_mouvements.down.sql." ;;
    "0027_pieces_consigne.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (consigne_echange_standard) — même limite que 0010 ; voir l'en-tête de down/0027_pieces_consigne.down.sql." ;;
    "0030_pointage.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (periode_pointage) — même limite que 0010 ; voir l'en-tête de down/0030_pointage.down.sql." ;;
    "0031_ventes_entite_auditee.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 4 valeurs (vehicule_stock, dossier_vente, reprise, financement_vente) — même limite que 0010 ; voir l'en-tête de down/0031_ventes_entite_auditee.down.sql (down intentionnellement vide, rien d'autre à défaire)." ;;
    "0033_vehicule_travail_reporte_motif_modification.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (vehicule_travail_reporte) — même limite que 0010 ; voir l'en-tête de down/0033_vehicule_travail_reporte_motif_modification.down.sql." ;;
    "0043_pneus_depot_pneus.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (depot_pneus) — même limite que 0010 ; voir l'en-tête de down/0043_pneus_depot_pneus.down.sql." ;;
    "0045_relances_socle.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (relance_planifiee) — même limite que 0010 ; voir l'en-tête de down/0045_relances_socle.down.sql." ;;
    "0047_stock_article_reservee_negatif_forcage.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur motif_liberation_reservation, 1 valeur (liberation_forcage_stock) — même limite que 0010 (aucun DROP VALUE en PostgreSQL), type différent (motif_liberation_reservation, pas entite_auditee) ; voir l'en-tête de down/0047_stock_article_reservee_negatif_forcage.down.sql." ;;
    "0052_rendez_vous_atelier.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur entite_auditee, 1 valeur (rendez_vous) — même limite que 0010 ; voir l'en-tête de down/0052_rendez_vous_atelier.down.sql." ;;
    "0055_pointage_motif_anomalie_cloture_fin_journee.sql")
      printf '%s' "ALTER TYPE ... ADD VALUE sur motif_anomalie_pointage, 1 valeur (cloture_fin_journee) — même limite que 0010 (aucun DROP VALUE en PostgreSQL) ; voir l'en-tête de down/0055_pointage_motif_anomalie_cloture_fin_journee.down.sql." ;;
    *)
      return 1 ;;
  esac
}

# --- Installation une seule fois (pas par migration) ---------------------------------------------
journaliser "Installation des dépendances (une seule fois pour toute la vérification)…"
(cd "$RACINE_DEPOT" && pnpm install --frozen-lockfile >"$REPERTOIRE_TRAVAIL/install.log" 2>&1) \
  || { journaliser "ÉCHEC pnpm install :"; cat "$REPERTOIRE_TRAVAIL/install.log" >&2; exit 1; }
(cd "$RACINE_DEPOT" && pnpm --filter @dfa/shared build >"$REPERTOIRE_TRAVAIL/build-shared.log" 2>&1) \
  || { journaliser "ÉCHEC build @dfa/shared :"; cat "$REPERTOIRE_TRAVAIL/build-shared.log" >&2; exit 1; }

# --- Liste des migrations, dans l'ordre où migrer.ts les applique réellement ---------------------
# `ls` plutôt que `find -printf` : BusyBox (Alpine, utilisé par le conteneur node:22-alpine côté
# CI/exécution conteneurisée) n'a pas `-printf`, seul GNU find l'a — `ls` reste portable partout.
# Boucle `while read` plutôt que `mapfile` (portabilité bash 3.2, voir la garde en tête de script :
# `mapfile`/`readarray` n'existent qu'à partir de bash 4).
FICHIERS_MONTANTS=()
while IFS= read -r fichier; do
  [[ -n "$fichier" ]] && FICHIERS_MONTANTS+=("$fichier")
done < <(cd "$REPERTOIRE_MIGRATIONS" && ls -1 -- *.sql 2>/dev/null | sort)
if [[ ${#FICHIERS_MONTANTS[@]} -eq 0 ]]; then
  journaliser "Aucune migration trouvée dans ${REPERTOIRE_MIGRATIONS} — rien à vérifier."
  exit 0
fi
# `${array[-1]}` (index négatif) n'existe qu'à partir de bash 4.2 — portabilité bash 3.2, voir la
# garde en tête de script.
INDICE_DERNIER=$(( ${#FICHIERS_MONTANTS[@]} - 1 ))
journaliser "${#FICHIERS_MONTANTS[@]} migration(s) à vérifier : ${FICHIERS_MONTANTS[0]} … ${FICHIERS_MONTANTS[$INDICE_DERNIER]}"

# Répertoire de travail qui grandit d'un fichier par itération — jamais apps/api/src/db/migrations/
# directement (voir appliquer_migrations_montantes ci-dessus). Vide au départ : à l'itération de
# 0000, seul 0000 y est présent, donc appliquerMigrations() n'applique QUE 0000, pas la suite.
REPERTOIRE_PROGRESSIF="$REPERTOIRE_TRAVAIL/migrations-progressif"
mkdir -p "$REPERTOIRE_PROGRESSIF"

# Amorce : fait créer `__dfa_migrations` (table d'infrastructure du runner, créée
# INCONDITIONNELLEMENT par appliquerMigrations() avant même de regarder les fichiers présents —
# voir migrer.ts) sur un répertoire encore VIDE, AVANT de capturer le dump « avant toute
# migration ». Sans cette étape, __dfa_migrations apparaîtrait à tort comme une différence
# imputable à la première migration testée, alors qu'elle n'est le fait d'aucune migration.
journaliser "Amorçage (création de __dfa_migrations, aucune migration appliquée)…"
if ! appliquer_migrations_montantes; then
  journaliser "ÉCHEC de l'amorçage — voir le journal ci-dessus."
  exit 1
fi

DUMP_AVANT="$REPERTOIRE_TRAVAIL/00-avant-tout.sql"
dump_schema "$DUMP_AVANT"

EN_ECHEC=0
for fichier_montant in "${FICHIERS_MONTANTS[@]}"; do
  nom_base="${fichier_montant%.sql}"
  fichier_down="$REPERTOIRE_DOWN/${nom_base}.down.sql"
  debut_migration=$(date +%s)

  if [[ ! -f "$fichier_down" ]]; then
    journaliser "ÉCHEC [${fichier_montant}] : aucun fichier down correspondant (${fichier_down} absent)."
    EN_ECHEC=1
    break
  fi

  journaliser "→ ${fichier_montant}"

  # Révèle cette seule migration au répertoire progressif (copie en lecture seule depuis la vraie
  # migration — jamais l'inverse).
  cp "$REPERTOIRE_MIGRATIONS/$fichier_montant" "$REPERTOIRE_PROGRESSIF/$fichier_montant"

  # 1) Montante.
  if ! appliquer_migrations_montantes; then
    journaliser "ÉCHEC [${fichier_montant}] : la migration montante elle-même échoue."
    EN_ECHEC=1
    break
  fi
  dump_apres_montante="$REPERTOIRE_TRAVAIL/${nom_base}.apres-montante.sql"
  dump_schema "$dump_apres_montante"

  # 2) Inverse.
  if ! appliquer_sql_fichier "$fichier_down"; then
    journaliser "ÉCHEC [${fichier_montant}] : le fichier down (${fichier_down}) échoue à l'exécution."
    EN_ECHEC=1
    break
  fi
  retirer_suivi_migration "$fichier_montant"
  dump_apres_down="$REPERTOIRE_TRAVAIL/${nom_base}.apres-down.sql"
  dump_schema "$dump_apres_down"

  # 3) Le schéma après le down doit être IDENTIQUE au schéma d'avant la migration — pas seulement
  #    « plausible », EXACTEMENT le même (c'est ce qui avait révélé le commentaire mal restauré de
  #    0012 : un down qui « a l'air » de défaire mais laisse une trace derrière lui). Exception
  #    listée dans obtenir_exception_down_partiel ci-dessus : diff toléré, mais affiché quand même,
  #    et les DEUX autres vérifications de cette migration restent pleinement exigées.
  if ! diff -u "$DUMP_AVANT" "$dump_apres_down" >"$REPERTOIRE_TRAVAIL/${nom_base}.diff-down.txt"; then
    if message_exception="$(obtenir_exception_down_partiel "$fichier_montant")"; then
      journaliser "  … down partiel ACCEPTÉ (exception documentée) : ${message_exception}"
      journaliser "  Diff résiduel (attendu, informationnel) :"
      sed 's/^/    /' "$REPERTOIRE_TRAVAIL/${nom_base}.diff-down.txt" >&2
    else
      journaliser "ÉCHEC [${fichier_montant}] : le down ne restaure PAS exactement l'état d'avant la migration."
      journaliser "  Diff (avant migration vs après down) :"
      sed 's/^/    /' "$REPERTOIRE_TRAVAIL/${nom_base}.diff-down.txt" >&2
      EN_ECHEC=1
      break
    fi
  fi

  # 4) Réapplication de la montante.
  if ! appliquer_migrations_montantes; then
    journaliser "ÉCHEC [${fichier_montant}] : la migration ne se réapplique pas après son propre down."
    EN_ECHEC=1
    break
  fi
  dump_apres_remontee="$REPERTOIRE_TRAVAIL/${nom_base}.apres-remontee.sql"
  dump_schema "$dump_apres_remontee"

  # 5) Le schéma après (montante, down, montante) doit être identique au schéma après la première
  #    montante — c'est le protocole manuel d'origine.
  if ! diff -u "$dump_apres_montante" "$dump_apres_remontee" >"$REPERTOIRE_TRAVAIL/${nom_base}.diff-remontee.txt"; then
    journaliser "ÉCHEC [${fichier_montant}] : réappliquer la migration après son down ne reproduit PAS le même schéma."
    journaliser "  Diff (première montante vs après down+remontée) :"
    sed 's/^/    /' "$REPERTOIRE_TRAVAIL/${nom_base}.diff-remontee.txt" >&2
    EN_ECHEC=1
    break
  fi

  duree_migration=$(( $(date +%s) - debut_migration ))
  journaliser "  ✓ ${fichier_montant} réversible (${duree_migration}s)."

  DUMP_AVANT="$dump_apres_remontee"
done

DUREE_TOTALE=$(( $(date +%s) - DEBUT_GLOBAL ))
if [[ "$EN_ECHEC" -eq 1 ]]; then
  journaliser "ÉCHEC — voir la migration désignée ci-dessus (${DUREE_TOTALE}s au total)."
  exit 1
fi

journaliser "OK — ${#FICHIERS_MONTANTS[@]} migration(s) réversible(s) (${DUREE_TOTALE}s au total)."
