-- =============================================================================================
-- 0001_socle_rls.down.sql — annulation de 0001_socle_rls.sql
--
-- ATTENTION : ce script DÉSACTIVE l'isolation multi-tenant. Après son exécution, le rôle
-- dfa_app voit toutes les données de tous les tenants. Il n'a de sens qu'en développement, en
-- CI, ou comme étape intermédiaire d'un retour arrière immédiatement suivi d'un redéploiement.
-- NE JAMAIS le laisser appliqué sur une base contenant des données de plusieurs clients.
--
-- Aucune donnée n'est perdue : ce script ne supprime que des règles et des privilèges.
-- À exécuter avec dfa_migrator, dans une transaction (le DDL PostgreSQL est transactionnel).
-- =============================================================================================

-- --- 5. Schéma amorcage ----------------------------------------------------------------------
-- `cascade` : supprime en une fois les 6 fonctions et leurs privilèges.
drop schema if exists amorcage cascade;

-- --- 4. Politiques et RLS ---------------------------------------------------------------------
drop policy if exists site_migrator                     on public.site;
drop policy if exists tenant_migrator                   on public.tenant;

drop policy if exists journal_securite_isolation_tenant on public.journal_securite;
drop policy if exists session_isolation_tenant          on public.session;
drop policy if exists utilisateur_isolation_tenant      on public.utilisateur;
drop policy if exists site_isolation_tenant             on public.site;
drop policy if exists tenant_isolation_tenant           on public.tenant;

alter table public.journal_securite no force row level security;
alter table public.session          no force row level security;
alter table public.utilisateur      no force row level security;
alter table public.site             no force row level security;
alter table public.tenant           no force row level security;

alter table public.journal_securite disable row level security;
alter table public.session          disable row level security;
alter table public.utilisateur      disable row level security;
alter table public.site             disable row level security;
alter table public.tenant           disable row level security;

-- --- 3. Privilèges ----------------------------------------------------------------------------
alter default privileges for role dfa_migrator in schema public
  revoke select, insert, update, delete on tables from dfa_app;

revoke all on public.journal_securite from dfa_app;
revoke all on public.session          from dfa_app;
revoke all on public.utilisateur      from dfa_app;
revoke all on public.site             from dfa_app;
revoke all on public.tenant           from dfa_app;

-- --- 2. Fonctions de contexte -----------------------------------------------------------------
drop function if exists public.requete_courante();
drop function if exists public.utilisateur_courant();
drop function if exists public.tenant_courant();
