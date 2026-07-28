-- =============================================================================================
-- 0008_atelier.down.sql — annulation de 0008_atelier.sql
--
-- 1) Retire les FK différées posées par 0008 sur les tables de 0007 (sinon 0007.down échoue en
--    aval sans qu'on puisse le diagnostiquer facilement).
-- 2) Détache les triggers/fonctions transverses à la table `ordre_reparation`/`ligne_or` avant de
--    supprimer les tables (drop table suffit à emporter triggers ET contraintes qui lui
--    appartiennent, mais les FONCTIONS partagées — recalculer_drapeaux_ordre_reparation — doivent
--    être supprimées explicitement une fois qu'aucun trigger n'en dépend plus).
-- 3) Ordre des tables : enfants avant parents.
-- =============================================================================================

alter table public.vehicule_travail_reporte drop constraint if exists vehicule_travail_reporte_fk_or_reprise;
alter table public.vehicule_travail_reporte drop constraint if exists vehicule_travail_reporte_fk_ligne_origine;
alter table public.vehicule_travail_reporte drop constraint if exists vehicule_travail_reporte_fk_or_origine;
alter table public.vehicule_campagne        drop constraint if exists vehicule_campagne_fk_or;
alter table public.vehicule_kilometrage     drop constraint if exists vehicule_kilometrage_fk_or;

drop table if exists public.or_controle_qualite;
drop table if exists public.devis_complementaire_ligne;

drop trigger if exists devis_complementaire_recalculer_drapeaux         on public.devis_complementaire;
drop trigger if exists devis_complementaire_verrouiller_apres_reponse   on public.devis_complementaire;
drop function if exists public.devis_complementaire_recalculer_drapeaux();
drop function if exists public.devis_complementaire_verrouiller_apres_reponse();
drop table if exists public.devis_complementaire;

drop trigger if exists ligne_or_recalculer_drapeaux on public.ligne_or;
drop function if exists public.ligne_or_recalculer_drapeaux();
drop function if exists public.recalculer_drapeaux_ordre_reparation(uuid, uuid);

drop trigger if exists ligne_or_interdire_suppression on public.ligne_or;
drop function if exists public.ligne_or_interdire_suppression();
drop trigger if exists ligne_or_verrouiller_or on public.ligne_or;
drop function if exists public.ligne_or_verrouiller_or();
drop table if exists public.ligne_or;

drop table if exists public.ordre_reparation_demande;

-- La table AVANT les fonctions : `drop table` emporte ses propres triggers
-- (ordre_reparation_incrementer_version, ordre_reparation_verrouiller_figes,
-- ordre_reparation_verifier_transition, ordre_reparation_audit, ordre_reparation_touche_modifie_le),
-- ce qui libère les fonctions dédiées à cette table pour un DROP FUNCTION sans CASCADE.
drop table if exists public.ordre_reparation;

drop function if exists public.ordre_reparation_incrementer_version();
drop function if exists public.ordre_reparation_verrouiller_figes();
