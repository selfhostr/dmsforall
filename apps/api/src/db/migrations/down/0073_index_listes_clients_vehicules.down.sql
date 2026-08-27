-- =============================================================================================
-- 0073_index_listes_clients_vehicules.down.sql — inverse de 0073_index_listes_clients_vehicules.sql
-- =============================================================================================

drop index if exists public.vehicule_expertise_vehicule_courante_idx;
drop index if exists public.vehicule_plaque_courante_valeur_idx;
drop index if exists public.client_tri_nom_idx;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'client_tri_nom_idx'
  ) then
    raise exception '0073 down : index client_tri_nom_idx toujours présent après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_plaque_courante_valeur_idx'
  ) then
    raise exception '0073 down : index vehicule_plaque_courante_valeur_idx toujours présent après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_expertise_vehicule_courante_idx'
  ) then
    raise exception '0073 down : index vehicule_expertise_vehicule_courante_idx toujours présent après le down.';
  end if;
end
$$;
