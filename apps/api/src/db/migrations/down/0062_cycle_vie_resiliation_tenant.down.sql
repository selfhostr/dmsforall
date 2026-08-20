-- =============================================================================================
-- 0062_cycle_vie_resiliation_tenant.down.sql — inverse de 0062_cycle_vie_resiliation_tenant.sql.
--
-- Ordre inverse du up : fonction de purge, trigger + fonction de transition, table événement
-- (dépend de resiliation_tenant par FK) avant resiliation_tenant, puis le type enum.
--
-- RÉVERSIBLE INTÉGRALEMENT — aucun résidu à documenter dans
-- `scripts/verifier-reversibilite-migrations.sh` : contrairement à 0010/0033/0043/0045/0047, cette
-- migration ne touche NI `entite_auditee` NI `transition_autorisee` (voir §A de l'en-tête du up) —
-- c'est précisément pour ça qu'aucun `ALTER TYPE ... ADD VALUE` n'a été posé, et donc rien
-- d'irréversible à laisser derrière. Migration de DONNÉES : aucune — les deux tables n'ont jamais
-- existé avant ce up (aucune ligne à perdre).
-- =============================================================================================

drop function public.purger_donnees_tenant(uuid, uuid, boolean);

drop trigger resiliation_tenant_verifier_transition on public.resiliation_tenant;
drop function public.verifier_transition_resiliation_tenant();

drop table public.resiliation_tenant_evenement;
drop table public.resiliation_tenant;

drop type public.statut_resiliation_tenant;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.resiliation_tenant') is not null then
    raise exception '0062 down : table resiliation_tenant toujours présente après le down.';
  end if;
  if to_regclass('public.resiliation_tenant_evenement') is not null then
    raise exception '0062 down : table resiliation_tenant_evenement toujours présente après le down.';
  end if;
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_resiliation_tenant') then
    raise exception '0062 down : type statut_resiliation_tenant toujours présent après le down.';
  end if;
  if to_regprocedure('public.purger_donnees_tenant(uuid, uuid, boolean)') is not null then
    raise exception '0062 down : fonction purger_donnees_tenant toujours présente après le down.';
  end if;
  if to_regprocedure('public.verifier_transition_resiliation_tenant()') is not null then
    raise exception '0062 down : fonction verifier_transition_resiliation_tenant toujours présente après le down.';
  end if;
end
$$;
