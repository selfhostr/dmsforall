-- =============================================================================================
-- 0077_index_tri_listes_or_factures.down.sql — inverse de 0077_index_tri_listes_or_factures.sql
-- =============================================================================================

drop index if exists public.document_vente_tri_date_idx;
drop index if exists public.ordre_reparation_tri_ouvert_le_idx;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('ordre_reparation_tri_ouvert_le_idx', 'document_vente_tri_date_idx')
  ) then
    raise exception '0077 down : un index est toujours présent après le down.';
  end if;
end
$$;
