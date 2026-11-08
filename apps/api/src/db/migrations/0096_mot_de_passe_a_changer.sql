-- =============================================================================================
-- 0096_mot_de_passe_a_changer.sql -- issue #58 : un employe cree ou reinitialise par la direction
-- doit choisir son propre mot de passe avant tout usage de l'application.
--
-- `utilisateur.mot_de_passe_a_changer` : pose a true a la creation d'un employe et a la
-- reinitialisation d'acces par la direction ; remis a false par le changement de mot de passe
-- (ou la reinitialisation en libre-service). Les comptes existants restent a false (aucune
-- application retroactive). Un compte de service (poste_atelier) ne peut jamais l'etre (CHECK).
--
-- `amorcage.session_par_empreinte` est recreee avec la colonne en DERNIERE position : l'API la lit
-- a chaque requete et refuse toute route metier tant que le changement n'est pas fait.
-- =============================================================================================

alter table public.utilisateur
  add column mot_de_passe_a_changer boolean not null default false;

alter table public.utilisateur
  add constraint utilisateur_mdp_a_changer_personne_chk
  check (not mot_de_passe_a_changer or role <> 'poste_atelier');

comment on column public.utilisateur.mot_de_passe_a_changer is
  'true tant que la personne n''a pas remplace le mot de passe temporaire donne par la direction (0096). Jamais vrai pour un compte de service.';

drop function amorcage.session_par_empreinte(bytea);

create function amorcage.session_par_empreinte(p_empreinte bytea)
returns table (
  session_id          uuid,
  tenant_id           uuid,
  utilisateur_id      uuid,
  cree_le             timestamptz,
  expire_le           timestamptz,
  vu_le               timestamptz,
  revoquee_le         timestamptz,
  role                role_utilisateur,
  langue              langue,
  statut_utilisateur  statut_utilisateur,
  statut_tenant       statut_tenant,
  site_id             uuid,
  niveau_atelier      public.niveau_acces,
  niveau_accueil      public.niveau_acces,
  niveau_facturation  public.niveau_acces,
  niveau_pieces       public.niveau_acces,
  niveau_ventes       public.niveau_acces,
  niveau_finances     public.niveau_acces,
  peut_encadrer       boolean,
  peut_gerer_employes boolean,
  est_patron          boolean,
  voit_montants       boolean,
  voit_prix_achat     boolean,
  avoirs_plafonnes    boolean,
  mot_de_passe_a_changer boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select s.id, s.tenant_id, s.utilisateur_id, s.cree_le, s.expire_le, s.vu_le, s.revoquee_le,
         u.role, u.langue, u.statut, t.statut, u.site_id,
         u.niveau_atelier, u.niveau_accueil, u.niveau_facturation, u.niveau_pieces,
         u.niveau_ventes, u.niveau_finances, u.peut_encadrer, u.peut_gerer_employes,
         u.est_patron, u.voit_montants, u.voit_prix_achat, u.avoirs_plafonnes,
         u.mot_de_passe_a_changer
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée. Rend aussi la grille de capacités et l''obligation de changer de mot de passe, relues à chaque requête.';

revoke all on function amorcage.session_par_empreinte(bytea) from public;
grant execute on function amorcage.session_par_empreinte(bytea) to dfa_app;

do $$
begin
  if has_function_privilege('public', 'amorcage.session_par_empreinte(bytea)', 'execute') then
    raise exception '0096 : amorcage.session_par_empreinte est exécutable par PUBLIC.';
  end if;
end
$$;
