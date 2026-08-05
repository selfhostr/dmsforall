-- =============================================================================================
-- 0044_vehicule_emplacement_libre.down.sql — inverse de 0044_vehicule_emplacement_libre.sql.
--
-- Aucune limite PostgreSQL à documenter ici (pas d'ALTER TYPE ADD VALUE dans le up) : le schéma
-- après ce down doit être IDENTIQUE bit à bit au schéma d'avant la migration montante. Migration
-- de DONNÉES : aucune — les deux colonnes n'ont jamais porté que des NULL (voir assertion §2 du
-- up), donc aucune perte d'information possible à ce DROP COLUMN.
-- =============================================================================================

alter table public.vehicule
  drop column emplacement_maj_le,
  drop column emplacement_libre;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule'
       and column_name in ('emplacement_libre', 'emplacement_maj_le')
  ) then
    raise exception '0044 down : emplacement_libre/emplacement_maj_le toujours présente(s) sur vehicule après le down.';
  end if;
end
$$;
