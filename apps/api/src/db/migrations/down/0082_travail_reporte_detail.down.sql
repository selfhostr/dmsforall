-- Inverse de 0082_travail_reporte_detail.sql.
alter table public.vehicule_travail_reporte
  drop constraint vehicule_travail_reporte_detail_non_vide_chk;

alter table public.vehicule_travail_reporte
  drop column detail;
