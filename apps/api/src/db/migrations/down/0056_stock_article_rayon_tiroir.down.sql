-- =============================================================================================
-- 0056_stock_article_rayon_tiroir.down.sql — inverse de 0056_stock_article_rayon_tiroir.sql.
--
-- `DROP COLUMN` retire automatiquement les CHECK qui ne portent QUE sur la colonne retirée
-- (`stock_article_rayon_normalise_chk` avec `rayon`, `stock_article_tiroir_normalise_chk` avec
-- `tiroir`) — aucun `DROP CONSTRAINT` explicite nécessaire, aucune limite PostgreSQL à documenter
-- ici (pas d'`ALTER TYPE ADD VALUE` dans le up). Le schéma après ce down doit être IDENTIQUE bit à
-- bit au schéma d'avant la migration montante. Migration de DONNÉES : aucune — les deux colonnes
-- n'ont jamais porté que des NULL en usage normal (voir l'assertion §3 du up : expand pur), donc
-- aucune perte d'information possible à ce DROP COLUMN.
-- =============================================================================================

alter table public.stock_article
  drop column tiroir,
  drop column rayon;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stock_article'
       and column_name in ('rayon', 'tiroir')
  ) then
    raise exception '0056 down : rayon/tiroir toujours présente(s) sur stock_article après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.stock_article'::regclass
       and conname in ('stock_article_rayon_normalise_chk', 'stock_article_tiroir_normalise_chk')
  ) then
    raise exception '0056 down : les CHECK de normalisation rayon/tiroir sont toujours présentes après le down.';
  end if;
end
$$;
