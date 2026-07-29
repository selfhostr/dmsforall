-- =============================================================================================
-- 0011_ordre_reparation_origine_reprise.down.sql — annulation de 0011.
--
-- Aucun type PG créé par 0011 (réutilise `origine_document` de 0010, qui reste en place tant que
-- 0010 n'est pas défaite séparément) : le down se limite à l'index, la contrainte et les deux
-- colonnes, dans l'ordre inverse de leur création.
-- =============================================================================================

drop index if exists public.ordre_reparation_numero_origine_uk;

alter table public.ordre_reparation
  drop constraint if exists ordre_reparation_origine_numero_origine_chk;

alter table public.ordre_reparation
  drop column if exists numero_origine,
  drop column if exists origine;
