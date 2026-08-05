-- =============================================================================================
-- 0045_relances_socle.down.sql — inverse de 0045_relances_socle.sql.
--
-- Ordre inverse du up : trigger d'audit retiré avant la table qui le porte, `relance_envoi`
-- (dépend de `relance_planifiee` par FK) avant `relance_planifiee`, elle-même avant
-- `regle_relance` (aucune dépendance entre elles, ordre arbitraire sinon), colonnes `client`
-- retirées ensuite, puis les six types enum.
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `relance_planifiee` en montante — aucun DROP
-- VALUE en PostgreSQL, même limite acceptée que 0010/0016/0025/0033/0043. Résidu documenté dans
-- `scripts/verifier-reversibilite-migrations.sh` (`obtenir_exception_down_partiel`, entrée
-- `0045_relances_socle.sql`). Migration de DONNÉES : aucune — les trois tables n'ont jamais
-- existé avant ce up (aucune ligne à perdre), et les deux colonnes `client` retirées ici ont été
-- ajoutées PAR ce up (aucune valeur antérieure à préserver : `plus_aucun_contact` valait
-- implicitement « faux » pour toute ligne existante, `motif` n'existait pas).
-- =============================================================================================

drop trigger relance_planifiee_audit on public.relance_planifiee;

alter table public.client drop constraint client_plus_aucun_contact_motif_chk;
alter table public.client drop column motif;
alter table public.client drop column plus_aucun_contact;

drop table public.relance_envoi;
drop table public.relance_planifiee;
drop table public.regle_relance;

drop function public.smallint_array_tous_positifs(smallint[]);

drop type public.statut_envoi_relance;
drop type public.canal_relance;
drop type public.raison_annulation_relance;
drop type public.statut_relance_planifiee;
drop type public.objet_type_relance;
drop type public.type_relance;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.regle_relance') is not null then
    raise exception '0045 down : table regle_relance toujours présente après le down.';
  end if;
  if to_regclass('public.relance_planifiee') is not null then
    raise exception '0045 down : table relance_planifiee toujours présente après le down.';
  end if;
  if to_regclass('public.relance_envoi') is not null then
    raise exception '0045 down : table relance_envoi toujours présente après le down.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'client' and column_name = 'plus_aucun_contact'
  ) then
    raise exception '0045 down : client.plus_aucun_contact toujours présente après le down.';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'client' and column_name = 'motif'
  ) then
    raise exception '0045 down : client.motif toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'type_relance') then
    raise exception '0045 down : type type_relance toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'objet_type_relance') then
    raise exception '0045 down : type objet_type_relance toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_relance_planifiee') then
    raise exception '0045 down : type statut_relance_planifiee toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'raison_annulation_relance') then
    raise exception '0045 down : type raison_annulation_relance toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'canal_relance') then
    raise exception '0045 down : type canal_relance toujours présent après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_envoi_relance') then
    raise exception '0045 down : type statut_envoi_relance toujours présent après le down.';
  end if;
end
$$;
