-- =============================================================================================
-- 0010_facturation.down.sql — annulation de 0010_facturation.sql
--
-- Ordre : FK différées d'abord (§14 de la migration up), puis les tables dans l'ordre INVERSE de
-- leurs dépendances FK (enfants avant parents), chaque DROP TABLE emportant ses propres triggers
-- et contraintes ; les FONCTIONS PARTAGÉES ou spécifiques à une table sont supprimées juste après
-- le DROP TABLE qui les rendait dépendantes. Puis les enums créés par 0010 (§1), et enfin les
-- ALTER TABLE additifs sur les tables 0005/0008 (§3, §4) — dans l'ordre inverse de la migration up.
--
-- LIMITE POSTGRESQL ASSUMÉE ET NON CONTOURNÉE : les six valeurs ajoutées à `entite_auditee` par
-- 0010 §2 (ALTER TYPE ... ADD VALUE) ne peuvent PAS être retirées — PostgreSQL n'offre aucun
-- « DROP VALUE » sur un type enum, seulement une recréation complète du type (renommage,
-- recréation, migration de toutes les colonnes qui l'utilisent, y compris `audit_atelier`
-- partitionnée sur 25 partitions, puis DROP de l'ancien type). Une telle opération est plus
-- risquée que ce qu'elle répare : elle toucherait une table déjà en production (audit_atelier
-- existe depuis 0004) pour annuler l'ajout de six libellés qui, seuls, ne changent aucun
-- comportement observable — un enum élargi sans les tables qui l'utilisent (document_vente,
-- paiement, etc., toutes supprimées ci-dessous) ne produit jamais de ligne d'audit portant ces
-- valeurs. Ce down laisse donc les six valeurs dans le type, documenté ici pour qu'un futur
-- lecteur ne les découvre pas par surprise dans `\dT+ entite_auditee`.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. RF-83 : retire la transition restitue → facture ajoutée en §15 de la migration up.
-- ---------------------------------------------------------------------------------------------

delete from public.transition_autorisee
 where entite = 'ordre_reparation' and statut_depuis = 'restitue' and statut_vers = 'facture';


-- ---------------------------------------------------------------------------------------------
-- 2. FK différées (§14 de la migration up)
-- ---------------------------------------------------------------------------------------------

alter table public.ligne_or        drop constraint if exists ligne_or_fk_facture;
alter table public.paiement        drop constraint if exists paiement_fk_export;
alter table public.document_vente  drop constraint if exists document_vente_fk_export;


-- ---------------------------------------------------------------------------------------------
-- 3. Export fiduciaire (§13 de la migration up) — enfants avant parents
-- ---------------------------------------------------------------------------------------------

drop table if exists public.export_comptable;
drop function if exists public.export_comptable_verifier_transition();

drop table if exists public.correspondance_externe;
drop table if exists public.mapping_code_tva;

drop table if exists public.mapping_compte;
drop function if exists public.mapping_compte_verrouiller();


-- ---------------------------------------------------------------------------------------------
-- 4. Paiements (§10→§12 de la migration up)
-- ---------------------------------------------------------------------------------------------

drop table if exists public.bulletin_paiement;

drop table if exists public.imputation_paiement;
drop function if exists public.imputation_paiement_verifier_invariants();

drop table if exists public.paiement;
drop function if exists public.paiement_verrouiller();


-- ---------------------------------------------------------------------------------------------
-- 5. Chaîne documentaire (§7→§9 de la migration up)
-- ---------------------------------------------------------------------------------------------

drop table if exists public.document_vente_tva;

drop table if exists public.ligne_document;
drop function if exists public.ligne_document_verifier_unicite_or();
drop function if exists public.ligne_document_verrouiller_document();

drop table if exists public.document_vente;
drop function if exists public.document_vente_verifier_periode();
drop function if exists public.document_vente_verrouiller_apres_emission();
drop function if exists public.document_vente_creation_brouillon();

drop table if exists public.transition_document_autorisee;
drop function if exists public.verifier_transition_document();

drop table if exists public.periode_comptable;
drop function if exists public.periode_comptable_verrouiller();


-- ---------------------------------------------------------------------------------------------
-- 6. Enums créés par 0010 §1
-- ---------------------------------------------------------------------------------------------

drop type if exists public.usage_mapping_compte;
drop type if exists public.cible_export;
drop type if exists public.mode_agregation_export;
drop type if exists public.statut_export_comptable;
drop type if exists public.motif_bulletin_paiement;
drop type if exists public.type_reference_qr;
drop type if exists public.portee_avoir;
drop type if exists public.motif_avoir;
drop type if exists public.paiement_source;
drop type if exists public.moyen_paiement;
drop type if exists public.nature_imputation;
drop type if exists public.type_ligne_document;
drop type if exists public.mode_calcul_tva;
drop type if exists public.regime_tva;
drop type if exists public.statut_reglement_document;
drop type if exists public.statut_document_vente;
drop type if exists public.nature_facture;
drop type if exists public.type_document_vente;
drop type if exists public.origine_document;


-- ---------------------------------------------------------------------------------------------
-- 7. ALTER TABLE additifs (§3, §4 de la migration up) — dans l'ordre inverse
-- ---------------------------------------------------------------------------------------------

alter table public.parametre_atelier drop constraint if exists parametre_atelier_taux_tva_defaut_chk;
alter table public.parametre_atelier drop column if exists arrondi_especes_actif;
alter table public.parametre_atelier drop column if exists taux_tva_defaut_pourmille;

alter table public.compteur_document drop constraint if exists compteur_document_valeur_coherente_chk;
alter table public.compteur_document drop constraint if exists compteur_document_valeur_depart_chk;
alter table public.compteur_document drop column if exists valeur_depart;
