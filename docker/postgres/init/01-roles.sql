-- Rôles Postgres applicatifs — indispensables pour que le RLS multi-tenant protège
-- effectivement quelque chose.
--
-- Un rôle superuser (comme `dfa`, celui du conteneur — cf. POSTGRES_USER dans
-- docker-compose.yml) ou tout rôle propriétaire des tables / marqué BYPASSRLS contourne
-- SILENCIEUSEMENT les politiques RLS. L'API ne doit donc JAMAIS se connecter avec `dfa`.
-- Ce script, exécuté en tant que superuser à l'initialisation du conteneur, crée les deux
-- rôles réellement utilisés ensuite :
--
--   - dfa_migrator : NOSUPERUSER, NOBYPASSRLS, propriétaire du schéma applicatif.
--     Utilisé uniquement par les migrations Drizzle (DATABASE_URL_MIGRATION dans .env).
--     Peut créer/modifier des tables, poser des politiques RLS.
--   - dfa_app      : NOSUPERUSER, NOBYPASSRLS, NON propriétaire des tables.
--     Seul rôle utilisé par l'API en exécution (DATABASE_URL dans .env). Soumis au RLS.
--
-- Les GRANT fins par table (SELECT/INSERT/UPDATE/DELETE pour dfa_app) et les politiques RLS
-- elles-mêmes sont posés par les migrations (domaine d'expert-database) — ce script se limite
-- volontairement à la création des rôles et aux droits par défaut sur le schéma `public`.
--
-- PIÈGE #1 (dev comme CI) : /docker-entrypoint-initdb.d/ ne s'exécute qu'à l'initialisation
-- d'un volume Postgres VIDE. Si le volume `dfa_postgres_data` existe déjà (installation
-- antérieure au contrat à deux rôles, par exemple), ce script ne sera PAS rejoué
-- automatiquement. Il faut repartir de zéro : `docker compose down -v` puis
-- `docker compose up -d`. Voir docs/deploiement-local.md.
--
-- PRODUCTION : sur une base managée (Infomaniak/Exoscale), il n'y a pas de conteneur
-- d'initialisation ni de docker-entrypoint-initdb.d. Ce script doit être rejoué UNE FOIS À LA
-- MAIN (psql, connecté avec le compte admin de l'instance managée) lors de la création de la
-- base de prod — avec des mots de passe forts et distincts générés pour l'occasion, jamais
-- les valeurs de dev ci-dessous.

CREATE ROLE dfa_migrator WITH
  LOGIN
  PASSWORD 'dfa_migrator_dev'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

CREATE ROLE dfa_app WITH
  LOGIN
  PASSWORD 'dfa_app_dev'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

-- dfa_migrator devient propriétaire du schéma public : les migrations (exécutées avec
-- DATABASE_URL_MIGRATION) créent donc des objets dont il est naturellement propriétaire.
ALTER SCHEMA public OWNER TO dfa_migrator;

-- On ferme l'accès par défaut du schéma à tout rôle (y compris PUBLIC, le pseudo-rôle
-- implicite de Postgres) : rien n'est accessible tant qu'un GRANT explicite n'a pas été posé.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- USAGE minimal pour que les deux rôles puissent résoudre les objets du schéma. Les droits
-- réels sur les tables (SELECT/INSERT/UPDATE/DELETE pour dfa_app) sont posés par les
-- migrations, table par table, en même temps que les politiques RLS correspondantes.
GRANT USAGE ON SCHEMA public TO dfa_migrator;
GRANT USAGE ON SCHEMA public TO dfa_app;

-- Droit de créer des SCHÉMAS dans la base.
--
-- Être propriétaire du schéma `public` ne suffit pas : créer un NOUVEAU schéma exige le
-- privilège CREATE sur la BASE elle-même, qui est un objet distinct. Sans ce GRANT, la
-- migration 0001 échoue sur `create schema amorcage` avec « permission denied for database ».
--
-- Le schéma `amorcage` (les 6 fonctions SECURITY DEFINER d'authentification) est créé par les
-- migrations et non ici, pour que sa définition reste versionnée avec le reste du schéma.
-- Seul le droit de le créer est accordé ici, parce qu'il relève du provisionnement de la base.
--
-- Le nom de la base n'est pas écrit en dur : ce script est rejoué tel quel en production sur une
-- base au nom différent, et par le harnais de tests d'intégration sur une base éphémère.
--
-- Bloc DO plutôt que la méta-commande psql `\gexec` : ce fichier doit rester exécutable par un
-- pilote SQL ordinaire. Les tests d'intégration (testcontainers) le rejouent via le pilote `pg`
-- pour reproduire exactement la posture de production — et un pilote ne connaît aucune
-- méta-commande psql, il verrait `\gexec` comme une erreur de syntaxe.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO dfa_migrator', current_database());
END
$$;
