-- =============================================================================================
-- 0083_ordre_reparation_devis_origine.down.sql — inverse de 0083_ordre_reparation_devis_origine.sql
-- Perte d'information : le lien OR <- devis est supprimé (les OR et les devis restent intacts).
-- =============================================================================================

drop index public.ordre_reparation_devis_origine_uk;

alter table public.ordre_reparation
  drop constraint ordre_reparation_fk_devis_origine;

alter table public.ordre_reparation
  drop column devis_origine_id;
