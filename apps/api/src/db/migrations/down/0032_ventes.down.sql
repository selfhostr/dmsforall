-- =============================================================================================
-- 0032_ventes.down.sql — inverse de 0032_ventes.sql.
--
-- `entite_auditee` gagne ses quatre valeurs dans 0031 (migration antérieure et séparée), pas
-- ici : rien à défaire de ce côté dans CE down (voir down/0031_ventes_entite_auditee.down.sql,
-- intentionnellement vide, PostgreSQL n'offrant aucun DROP VALUE).
--
-- ORDRE : inverse exact de la montante — la FK croisée vehicule_stock -> dossier_vente (posée en
-- §4 de la montante) doit être retirée AVANT de pouvoir dropper dossier_vente ; document_vente
-- perd sa FK vers dossier_vente avant que dossier_vente ne disparaisse.
-- =============================================================================================

alter table public.document_vente drop constraint document_vente_fk_dossier_vente;

delete from public.transition_autorisee
 where entite in ('vehicule_stock', 'dossier_vente', 'reprise', 'financement_vente');

drop table public.dossier_vente_document_requis;
drop table public.financement_vente;
drop table public.reprise;

alter table public.vehicule_stock drop constraint vehicule_stock_fk_origine_reprise;

drop table public.dossier_vente;
drop table public.vehicule_stock;

drop type public.statut_financement_vente;
drop type public.type_financement_vente;
drop type public.statut_reprise;
drop type public.statut_dossier_vente;
drop type public.statut_vehicule_stock;
