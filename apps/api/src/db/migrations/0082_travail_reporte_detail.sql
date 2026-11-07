-- =============================================================================================
-- 0082_travail_reporte_detail.sql — détail libre d'un travail reporté saisi à la main
-- (« à faire la prochaine fois : courroie »). `designation` reste le titre court ; `detail` porte
-- l'explication (symptôme, pièce à prévoir). Nullable, non vide quand renseigné.
-- Migration de DONNÉES : aucune. Réversible : down/0082_travail_reporte_detail.down.sql.
-- =============================================================================================

alter table public.vehicule_travail_reporte
  add column detail text null;

alter table public.vehicule_travail_reporte
  add constraint vehicule_travail_reporte_detail_non_vide_chk
  check (detail is null or length(btrim(detail)) > 0);
