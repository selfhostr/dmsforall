-- =============================================================================================
-- 0039_poste_atelier_compte_de_service.down.sql — inverse EXACT de
-- 0039_poste_atelier_compte_de_service.sql.
--
-- Réversibilité INTÉGRALE, sans exception à déclarer dans
-- `scripts/verifier-reversibilite-migrations.sh` : la montante recrée le type `role_utilisateur`
-- au lieu d'un `alter type ... add value` précisément pour que ce down puisse le ramener à ses
-- huit valeurs d'origine (PostgreSQL n'offre aucun « DROP VALUE » — la recréation est la SEULE
-- voie, et elle est praticable ici car le type n'a que trois dépendants ; voir l'en-tête de la
-- montante).
--
-- Ordre : miroir strict de la montante (§1 → §7 devient §7 → §1).
--
-- DONNÉES : ce down REFUSE de s'exécuter s'il existe encore un compte `poste_atelier` (§2). Les
-- supprimer ou les rétrograder silencieusement ferait disparaître des bornes déclarées et, avec
-- elles, l'imputation de leurs pointages — un down doit défaire une STRUCTURE, jamais décider à
-- la place d'un exploitant du sort de ses données.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Fonctions d'amorçage retirées (elles dépendent du type à recréer).
-- ---------------------------------------------------------------------------------------------

drop function amorcage.utilisateur_par_email(text);
drop function amorcage.session_par_empreinte(bytea);


-- ---------------------------------------------------------------------------------------------
-- 2. Refus explicite si des comptes de service existent encore.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  n integer;
begin
  select count(*) into n from public.utilisateur where role = 'poste_atelier';
  if n <> 0 then
    raise exception
      '0039 (down) : % compte(s) de service poste_atelier existent encore. Les retirer ou les rétrograder DÉLIBÉRÉMENT avant de redescendre — ce down ne décide pas du sort de bornes déclarées.',
      n;
  end if;
end
$$;


-- ---------------------------------------------------------------------------------------------
-- 3. Index, contraintes et colonne `site_id` retirés (ordre inverse du §3 de la montante).
--
-- La CHECK doit tomber AVANT le changement de type de `role` : elle compare à la valeur
-- 'poste_atelier', absente du type restauré.
-- ---------------------------------------------------------------------------------------------

drop index public.utilisateur_site_idx;

alter table public.utilisateur
  drop constraint utilisateur_site_compte_de_service_chk;

alter table public.utilisateur
  drop constraint utilisateur_fk_site;

alter table public.utilisateur
  drop column site_id;


-- ---------------------------------------------------------------------------------------------
-- 4. `role_utilisateur` restauré à ses huit valeurs d'origine (texte exact de 0000 §1).
-- ---------------------------------------------------------------------------------------------

alter type public.role_utilisateur rename to role_utilisateur_apres_0039;

create type public.role_utilisateur as enum (
  'admin', 'direction', 'vendeur', 'receptionnaire', 'chef_atelier', 'technicien', 'magasinier', 'comptable'
);

alter table public.utilisateur
  alter column role type public.role_utilisateur
  using role::text::public.role_utilisateur;

drop type public.role_utilisateur_apres_0039;


-- ---------------------------------------------------------------------------------------------
-- 5. Fonctions d'amorçage restaurées au texte EXACT de 0001 §5.1 et §5.2 (sans `site_id`).
-- ---------------------------------------------------------------------------------------------

create function amorcage.utilisateur_par_email(p_email text)
returns table (
  id                 uuid,
  tenant_id          uuid,
  email              text,
  mot_de_passe_hash  text,
  statut             statut_utilisateur,
  statut_tenant      statut_tenant,
  role               role_utilisateur,
  langue             langue,
  echecs_connexion   smallint,
  verrouille_jusqu_a timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.id,
         u.tenant_id,
         u.email,
         u.mot_de_passe_hash,
         u.statut,
         t.statut,
         u.role,
         u.langue,
         u.echecs_connexion,
         u.verrouille_jusqu_a
    from public.utilisateur u
    join public.tenant t on t.id = u.tenant_id
   where u.email = lower(btrim(p_email))
   limit 1
$$;

comment on function amorcage.utilisateur_par_email(text) is
  'Résolution d''un compte par email, hors contexte tenant (le tenant n''est pas encore connu à la connexion). Colonnes explicites : voir UtilisateurAmorcage.';

create function amorcage.session_par_empreinte(p_empreinte bytea)
returns table (
  session_id         uuid,
  tenant_id          uuid,
  utilisateur_id     uuid,
  cree_le            timestamptz,
  expire_le          timestamptz,
  vu_le              timestamptz,
  revoquee_le        timestamptz,
  role               role_utilisateur,
  langue             langue,
  statut_utilisateur statut_utilisateur,
  statut_tenant      statut_tenant
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id,
         s.tenant_id,
         s.utilisateur_id,
         s.cree_le,
         s.expire_le,
         s.vu_le,
         s.revoquee_le,
         u.role,
         u.langue,
         u.statut,
         t.statut
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée.';


-- ---------------------------------------------------------------------------------------------
-- 6. Privilèges restaurés (0001 §5.7 : on ferme d'abord, on ouvre nommément ensuite).
-- ---------------------------------------------------------------------------------------------

revoke all on function amorcage.utilisateur_par_email(text)  from public;
revoke all on function amorcage.session_par_empreinte(bytea) from public;

grant execute on function amorcage.utilisateur_par_email(text)  to dfa_app;
grant execute on function amorcage.session_par_empreinte(bytea) to dfa_app;
