-- =============================================================================================
-- 0061_anonymisation_client.down.sql — inverse de 0061_anonymisation_client.sql
--
-- Aucune table/colonne EXISTANTE n'a été modifiée par la montante (uniquement une table neuve et
-- une fonction neuve) : le down se limite donc à les retirer, rien à restaurer.
-- =============================================================================================

drop function if exists public.anonymiser_client_donnees(uuid, uuid);
drop table if exists public.client_anonymisation;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'client_anonymisation'
  ) then
    raise exception '0061 down : table client_anonymisation toujours présente après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'anonymiser_client_donnees'
  ) then
    raise exception '0061 down : fonction anonymiser_client_donnees toujours présente après le down.';
  end if;
end
$$;
