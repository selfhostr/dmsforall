-- =============================================================================================
-- 0007_vehicules.down.sql — annulation de 0007_vehicules.sql
--
-- Si 0008 est encore appliquée, les `alter table … add constraint` qu'elle pose sur
-- `vehicule_kilometrage`, `vehicule_campagne` et `vehicule_travail_reporte` (FK vers
-- `ordre_reparation`/`ligne_or`) font échouer les `drop table` ci-dessous sans `cascade` — voulu :
-- annuler 0007 exige d'avoir annulé 0008 d'abord.
-- =============================================================================================

drop table if exists public.vehicule_travail_reporte;
drop table if exists public.vehicule_campagne;
drop table if exists public.vehicule_expertise;
drop table if exists public.vehicule_kilometrage;
drop table if exists public.vehicule_detention;
drop table if exists public.vehicule_plaque;
drop table if exists public.vehicule;
