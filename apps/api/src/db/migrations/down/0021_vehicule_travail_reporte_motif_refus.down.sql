-- =============================================================================================
-- 0021_vehicule_travail_reporte_motif_refus.down.sql — annulation de
-- 0021_vehicule_travail_reporte_motif_refus.sql
--
-- Ordre inverse du up : commentaire de table restauré au texte exact de 0007 (down annule la
-- CORRECTION de 0021, pas 0007 elle-même, déjà appliquée et immuable — même logique que
-- 0016/0017/0018/0019), puis CHECK, puis colonne. Migration de DONNÉES : aucune — la colonne n'a
-- jamais porté que des NULL (voir assertion §3 du up), donc aucune perte d'information possible
-- à ce DROP COLUMN.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0007 (avant l'ajout de la phrase 0021).
-- ---------------------------------------------------------------------------------------------

comment on table public.vehicule_travail_reporte is
  'Travaux reportés d''un véhicule (RM-73), MATÉRIALISÉS et éditables — pas une vue sur ligne_or.';


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  drop constraint if exists vehicule_travail_reporte_motif_refus_non_vide_chk;


-- ---------------------------------------------------------------------------------------------
-- 3. Colonne retirée — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  drop column if exists motif_refus;
