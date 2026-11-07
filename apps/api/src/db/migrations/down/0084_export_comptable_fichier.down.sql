-- =============================================================================================
-- 0084_export_comptable_fichier.down.sql — inverse de 0084_export_comptable_fichier.sql
-- =============================================================================================

drop table if exists public.export_comptable_fichier;

alter table public.export_comptable
  drop constraint if exists export_comptable_compteurs_chk,
  drop column if exists nb_factures,
  drop column if exists nb_avoirs,
  drop column if exists nb_encaissements,
  drop column if exists total_ht_centimes,
  drop column if exists total_tva_centimes,
  drop column if exists total_ttc_centimes,
  drop column if exists facture_premier,
  drop column if exists facture_dernier,
  drop column if exists avoir_premier,
  drop column if exists avoir_dernier;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'export_comptable_fichier'
  ) then
    raise exception '0084 down : export_comptable_fichier est toujours présente après le down.';
  end if;
end
$$;
