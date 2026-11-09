-- Development roles, replayed by the postgres container of docker/compose.dev.yml on the first
-- start with an empty volume (and by the integration tests, on a throwaway cluster).
--
-- The container starts as superuser (dfa) only to run this script. The application uses two
-- other roles, neither superuser nor BYPASSRLS, so that row level security applies to it:
--   dfa_migrator  owns the schema, used by migrations only
--   dfa_app       used by the running API, owns nothing
--   dfa_console   optional operations console role (see migration 0048)
--
-- The passwords below are public development values. The production stack
-- (docker-compose.yml) does not use this file: it creates the same roles with generated
-- passwords, and the API refuses to start in production with the values below.
--
-- After editing this file: `docker compose -f docker/compose.dev.yml down -v`, to replay it.

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

CREATE ROLE dfa_console WITH
  LOGIN
  PASSWORD 'dfa_console_dev'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

-- The migrator owns the public schema; nobody else gets rights by default.
ALTER SCHEMA public OWNER TO dfa_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dfa_migrator;
GRANT USAGE ON SCHEMA public TO dfa_app;

-- The migrator may create schemas in the database it runs in (the name differs between dev
-- and test databases, hence the dynamic statement).
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO dfa_migrator', current_database());
END
$$;
