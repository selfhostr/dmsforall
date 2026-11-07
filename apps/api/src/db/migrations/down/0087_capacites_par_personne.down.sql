-- =============================================================================================
-- 0087_capacites_par_personne.down.sql — inverse de 0087_capacites_par_personne.sql
--
-- Restaure `amorcage.session_par_empreinte` telle que 0039 l'a laissée, puis retire trigger,
-- fonctions, contraintes, colonnes et type. La grille des personnes est perdue (le rôle redevient
-- la seule source de droits) ; `role` n'a jamais été modifié par 0087, aucun droit historique n'est
-- donc touché.
-- =============================================================================================

drop function amorcage.session_par_empreinte(bytea);

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
  statut_tenant      statut_tenant,
  site_id            uuid
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
         t.statut,
         u.site_id
    from public.session s
    join public.utilisateur u on u.id = s.utilisateur_id and u.tenant_id = s.tenant_id
    join public.tenant t      on t.id = s.tenant_id
   where s.empreinte_token = p_empreinte
   limit 1
$$;

comment on function amorcage.session_par_empreinte(bytea) is
  'Résolution d''une session par empreinte SHA-256. Ne filtre ni expiration ni révocation : ServiceSession doit distinguer session absente et session expirée.';

revoke all on function amorcage.session_par_empreinte(bytea) from public;
grant execute on function amorcage.session_par_empreinte(bytea) to dfa_app;

drop trigger if exists utilisateur_grille_par_defaut on public.utilisateur;
drop function if exists public.utilisateur_grille_par_defaut();

alter table public.utilisateur
  drop constraint if exists utilisateur_borne_sans_grille_chk,
  drop constraint if exists utilisateur_patron_gere_employes_chk,
  drop column if exists niveau_atelier,
  drop column if exists niveau_accueil,
  drop column if exists niveau_facturation,
  drop column if exists niveau_pieces,
  drop column if exists niveau_ventes,
  drop column if exists niveau_finances,
  drop column if exists peut_encadrer,
  drop column if exists peut_gerer_employes,
  drop column if exists est_patron,
  drop column if exists voit_montants,
  drop column if exists voit_prix_achat,
  drop column if exists avoirs_plafonnes;

drop function if exists public.grille_prereglage(public.role_utilisateur);
drop type if exists public.niveau_acces;

do $$
begin
  if exists (select 1 from pg_catalog.pg_type where typname = 'niveau_acces') then
    raise exception '0087 down : le type niveau_acces existe encore.';
  end if;
end
$$;
