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
-- FILET DE PRODUCTION (audit sécurité, voir docs/deploiement-production.md §3.2/§8) : sur la
-- base nommée EXACTEMENT `dfa_prod` (et seulement celle-là — jamais `dfa_dev` ni `dfa_test`, voir
-- plus bas), ces deux rôles sont créés avec une expiration automatique courte. Le mot de passe de
-- DEV ci-dessous ne doit JAMAIS rester valide en production au-delà de la rotation immédiate
-- prévue par la procédure ; s'il l'est quand même (rotation oubliée après une bascule ou une
-- montée de version majeure), il expire de lui-même plutôt que de rester une porte ouverte
-- silencieuse. La procédure de rotation lève cette expiration (`valid until 'infinity'`) --
-- c'est une étape obligatoire de cette procédure, pas une option.
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
-- PRODUCTION (à jour avec docker-compose.yml — auto-hébergement, décision actée, voir
-- docs/deploiement-production.md §2) : PAS de base managée, PAS de compte admin d'hébergeur à qui
-- parler. `docker-compose.yml` monte ce même fichier au même chemin que le
-- docker-compose.yml de dev : au tout premier démarrage du conteneur `postgres` sur un volume
-- `dfa_postgres_data` vide, il rejoue AUTOMATIQUEMENT, exactement comme en dev — pas de rejeu
-- manuel via psql. Ce qui reste manuel, et ne peut pas être automatisé sans risque : la rotation
-- immédiate des mots de passe de dev ci-dessous vers des valeurs fortes et distinctes, AVANT
-- d'ouvrir le reverse proxy au public — procédure détaillée dans
-- docs/deploiement-production.md §3.2 (premier déploiement) et §3.7 (après une montée de version
-- majeure, qui recrée un volume vide et donc rejoue ce script une nouvelle fois). Le filet
-- d'expiration automatique ci-dessus ne dispense jamais de cette rotation, il limite seulement la
-- durée d'un oubli.

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

-- Filet de production : voir le commentaire d'en-tête. UNIQUEMENT sur la base `dfa_prod`
-- (jamais `dfa_dev` en développement local, jamais `dfa_test` sous testcontainers — les deux
-- noms sont fixés ailleurs et ne collisionnent jamais avec celui-ci, voir docker-compose.yml et
-- apps/api/test/setup/postgres-ephemere.ts) : les mots de passe de dev posés ci-dessus expirent
-- d'eux-mêmes 7 jours après ce tout premier démarrage. Assez court pour transformer un oubli de
-- rotation en panne visible (connexions refusées, alerte de monitoring, voir
-- docs/deploiement-production.md §9) plutôt qu'une faille silencieuse qui peut durer des mois ;
-- assez long pour ne pas coincer une bascule effectuée un vendredi soir contre un week-end entier
-- sans marge. La procédure de rotation (§3.2, §3.7, §8) lève cette expiration explicitement
-- (`alter role ... valid until 'infinity'`) une fois le vrai mot de passe posé — sans cette
-- étape, même une rotation de mot de passe correctement faite finirait par expirer au bout de
-- 7 jours, donc elle est décrite comme partie intégrante de la rotation, pas une option annexe.
DO $$
BEGIN
  IF current_database() = 'dfa_prod' THEN
    EXECUTE 'ALTER ROLE dfa_migrator VALID UNTIL ' || quote_literal((now() + interval '7 days')::text);
    EXECUTE 'ALTER ROLE dfa_app VALID UNTIL ' || quote_literal((now() + interval '7 days')::text);
  END IF;
END
$$;

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
