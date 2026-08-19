-- =============================================================================================
-- 0059_factures_fournisseur.down.sql — inverse de 0059_factures_fournisseur.sql.
--
-- Schéma après ce down identique bit à bit au schéma d'avant la migration montante. Migration de
-- données : aucune (tables neuves, jamais alimentées avant cette migration montante). Ordre de
-- suppression = inverse strict de la création (les FK l'imposent : les tables filles d'abord).
-- =============================================================================================

drop table if exists public.facture_fournisseur_audit;
drop table if exists public.facture_fournisseur_ligne;
drop table if exists public.facture_fournisseur;
drop table if exists public.facture_fournisseur_document;

drop type if exists public.action_audit_facture_fournisseur;
drop type if exists public.origine_donnee_facture;
drop type if exists public.statut_facture_fournisseur;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.facture_fournisseur_document') is not null then
    raise exception '0059 down : table facture_fournisseur_document toujours présente après le down.';
  end if;
  if to_regclass('public.facture_fournisseur') is not null then
    raise exception '0059 down : table facture_fournisseur toujours présente après le down.';
  end if;
  if to_regclass('public.facture_fournisseur_ligne') is not null then
    raise exception '0059 down : table facture_fournisseur_ligne toujours présente après le down.';
  end if;
  if to_regclass('public.facture_fournisseur_audit') is not null then
    raise exception '0059 down : table facture_fournisseur_audit toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_facture_fournisseur') then
    raise exception '0059 down : type statut_facture_fournisseur toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'origine_donnee_facture') then
    raise exception '0059 down : type origine_donnee_facture toujours présent après le down.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_type where typname = 'action_audit_facture_fournisseur'
  ) then
    raise exception '0059 down : type action_audit_facture_fournisseur toujours présent après le down.';
  end if;
end
$$;
