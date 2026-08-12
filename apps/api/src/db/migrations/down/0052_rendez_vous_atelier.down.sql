-- =============================================================================================
-- 0052_rendez_vous_atelier.down.sql — inverse de 0052_rendez_vous_atelier.sql.
--
-- Ordre : défaire ordre_reparation (FK + index) AVANT de toucher rendez_vous (dépendance), puis le
-- trigger d'audit posé APRÈS la table dans le up (retiré AVANT elle ici, même symétrie que 0043),
-- puis `drop table rendez_vous` (cascade sur ses propres contraintes/index/policies/triggers
-- restants, y compris rendez_vous_empecher_reouverture et sa fonction — non : la fonction n'est PAS
-- droppée par cascade, une fonction n'appartient pas à la table qui la déclenche ; retirée
-- explicitement ci-dessous), puis les trois types enum.
--
-- NE PEUT PAS DÉFAIRE : `entite_auditee` gagne `rendez_vous` en montante — aucun DROP VALUE en
-- PostgreSQL, même limite acceptée que 0010/0016/0025/0033/0043. Résidu documenté dans
-- `scripts/verifier-reversibilite-migrations.sh` (`obtenir_exception_down_partiel`, entrée
-- `0052_rendez_vous_atelier.sql`). Migration de DONNÉES : aucune — `rendez_vous` n'a jamais existé
-- avant ce up, donc aucune perte d'information possible à ce DROP TABLE ; `rendez_vous_id` était
-- NULL sur toute ligne `ordre_reparation` existante avant le up, donc `DROP CONSTRAINT` ci-dessous
-- ne perd rien non plus.
-- =============================================================================================

drop index public.ordre_reparation_rendez_vous_idx;

alter table public.ordre_reparation
  drop constraint ordre_reparation_fk_rendez_vous;

drop trigger rendez_vous_audit on public.rendez_vous;

drop trigger rendez_vous_empecher_reouverture on public.rendez_vous;

drop table public.rendez_vous;

drop function public.rendez_vous_empecher_reouverture();

drop type public.origine_creation_rendez_vous;
drop type public.statut_prise_rendez_vous;
drop type public.moment_rendez_vous;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.rendez_vous') is not null then
    raise exception '0052 down : table rendez_vous toujours présente après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'ordre_reparation_fk_rendez_vous'
       and conrelid = 'public.ordre_reparation'::regclass
  ) then
    raise exception '0052 down : contrainte ordre_reparation_fk_rendez_vous toujours présente après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'ordre_reparation'
       and indexname = 'ordre_reparation_rendez_vous_idx'
  ) then
    raise exception '0052 down : index ordre_reparation_rendez_vous_idx toujours présent après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'moment_rendez_vous') then
    raise exception '0052 down : type moment_rendez_vous toujours présent après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_prise_rendez_vous') then
    raise exception '0052 down : type statut_prise_rendez_vous toujours présent après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'origine_creation_rendez_vous') then
    raise exception '0052 down : type origine_creation_rendez_vous toujours présent après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc where proname = 'rendez_vous_empecher_reouverture'
  ) then
    raise exception '0052 down : fonction rendez_vous_empecher_reouverture toujours présente après le down.';
  end if;
end
$$;
