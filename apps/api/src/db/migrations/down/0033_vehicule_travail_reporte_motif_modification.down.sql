-- =============================================================================================
-- 0033_vehicule_travail_reporte_motif_modification.down.sql — annulation de
-- 0033_vehicule_travail_reporte_motif_modification.sql
--
-- Ordre inverse du up : commentaire de table restauré au texte exact de 0021 (down annule la
-- CORRECTION de 0033, pas 0021 elle-même, déjà appliquée et immuable — même logique que
-- 0016/0021), puis trigger d'audit, puis CHECK, puis colonne. NE PEUT PAS retirer la valeur
-- `vehicule_travail_reporte` de `entite_auditee` — PostgreSQL n'offre aucun « DROP VALUE » sur un
-- type enum existant (même limite acceptée que 0016/0021/0023) : elle reste dans le type, sans
-- effet observable une fois le trigger retiré. Migration de DONNÉES : aucune — la colonne n'a
-- jamais porté que des NULL (voir assertion §3 du up), donc aucune perte d'information possible à
-- ce DROP COLUMN.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0021 (avant l'ajout des phrases 0033).
-- ---------------------------------------------------------------------------------------------

comment on table public.vehicule_travail_reporte is
  'Travaux reportés d''un véhicule (RM-73), MATÉRIALISÉS et éditables — pas une vue sur ligne_or. '
  '`motif_refus` (0021) : raison du refus saisie au comptoir, consultée au passage suivant — '
  'PAS encore tracée par l''audit générique (voir la migration : cette table n''est pas dans '
  '`entite_auditee`), seule sa valeur COURANTE est durablement lisible.';


-- ---------------------------------------------------------------------------------------------
-- 2. Trigger d'audit retiré.
-- ---------------------------------------------------------------------------------------------

drop trigger if exists vehicule_travail_reporte_audit on public.vehicule_travail_reporte;


-- ---------------------------------------------------------------------------------------------
-- 3. CHECK retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  drop constraint if exists vehicule_travail_reporte_motif_modification_non_vide_chk;


-- ---------------------------------------------------------------------------------------------
-- 4. Colonne retirée — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule_travail_reporte
  drop column if exists motif_modification;
