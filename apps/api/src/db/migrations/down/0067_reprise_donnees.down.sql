-- =============================================================================================
-- 0067_reprise_donnees.down.sql — inverse de 0067_reprise_donnees.sql.
--
-- Schéma après ce down identique bit à bit au schéma d'avant la migration montante. Migration de
-- données : aucune (tables neuves, jamais alimentées avant cette migration montante). Ordre de
-- suppression = inverse strict de la création (les FK l'imposent : les tables filles d'abord —
-- reprise_rapport et reprise_import référencent reprise_plan, qui référence reprise_analyse, qui
-- référence dossier_reprise ; reprise_tranche référence directement dossier_reprise).
-- =============================================================================================

drop table if exists public.reprise_rapport;
drop table if exists public.reprise_import;
drop table if exists public.reprise_plan;
drop table if exists public.reprise_analyse;
drop table if exists public.reprise_tranche;
drop table if exists public.dossier_reprise;

drop type if exists public.domaine_reprise;
drop type if exists public.statut_import_reprise;
drop type if exists public.statut_plan_reprise;
drop type if exists public.statut_analyse_reprise;
drop type if exists public.statut_dossier_reprise;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.dossier_reprise') is not null then
    raise exception '0067 down : table dossier_reprise toujours présente après le down.';
  end if;
  if to_regclass('public.reprise_tranche') is not null then
    raise exception '0067 down : table reprise_tranche toujours présente après le down.';
  end if;
  if to_regclass('public.reprise_analyse') is not null then
    raise exception '0067 down : table reprise_analyse toujours présente après le down.';
  end if;
  if to_regclass('public.reprise_plan') is not null then
    raise exception '0067 down : table reprise_plan toujours présente après le down.';
  end if;
  if to_regclass('public.reprise_import') is not null then
    raise exception '0067 down : table reprise_import toujours présente après le down.';
  end if;
  if to_regclass('public.reprise_rapport') is not null then
    raise exception '0067 down : table reprise_rapport toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_dossier_reprise') then
    raise exception '0067 down : type statut_dossier_reprise toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_analyse_reprise') then
    raise exception '0067 down : type statut_analyse_reprise toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_plan_reprise') then
    raise exception '0067 down : type statut_plan_reprise toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_import_reprise') then
    raise exception '0067 down : type statut_import_reprise toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'domaine_reprise') then
    raise exception '0067 down : type domaine_reprise toujours présent après le down.';
  end if;
end
$$;
