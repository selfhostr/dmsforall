-- =============================================================================================
-- 0060_type_approbation_ch_trgm_idx.down.sql — inverse de 0060_type_approbation_ch_trgm_idx.sql
-- =============================================================================================

drop index if exists public.type_approbation_ch_code_type_trgm_idx;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'type_approbation_ch_code_type_trgm_idx'
  ) then
    raise exception '0060 down : index type_approbation_ch_code_type_trgm_idx toujours présent après le down.';
  end if;
end
$$;
