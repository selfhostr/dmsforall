-- =============================================================================================
-- 0019_imputation_paiement_export.down.sql — annulation de 0019_imputation_paiement_export.sql
--
-- Ordre inverse du up : commentaire de table restauré au texte exact de 0010 (down annule la
-- CORRECTION de 0019, pas 0010 elle-même, déjà appliquée et immuable — même logique que
-- 0016/0017/0018.down), puis index, puis audit ramené à INSERT seul, puis trigger
-- d'immuabilité retiré, puis privilège UPDATE retiré (retour à SELECT/INSERT seuls, l'état
-- d'origine de 0010), puis FK, puis colonnes. Migration de DONNÉES : aucune — les deux colonnes
-- n'ont jamais porté que des NULL (voir assertion §7 du up), donc aucune perte d'information
-- possible à ce DROP COLUMN.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0010 (avant l'ajout de la phrase 0019).
-- ---------------------------------------------------------------------------------------------

comment on table public.imputation_paiement is
  'Ce que le paiement solde (MD-50). MD-51 : deux invariants agrégés, vérifiés par trigger AFTER '
  'INSERT — (a) Σ imputations d''un document ≤ |total| du document ; (b) Σ imputations de nature '
  '''reglement'' d''un paiement ≤ |montant| du paiement (restriction volontaire, voir CF-05).';


-- ---------------------------------------------------------------------------------------------
-- 2. Index partiel retiré.
-- ---------------------------------------------------------------------------------------------

drop index if exists public.imputation_paiement_a_exporter_idx;


-- ---------------------------------------------------------------------------------------------
-- 3. Audit ramené à AFTER INSERT seul (état de 0010).
-- ---------------------------------------------------------------------------------------------

drop trigger if exists imputation_paiement_audit on public.imputation_paiement;

create trigger imputation_paiement_audit
  after insert on public.imputation_paiement
  for each row execute function public.auditer_atelier('imputation_paiement');


-- ---------------------------------------------------------------------------------------------
-- 4. Trigger d'immuabilité et sa fonction retirés — n'existaient pas avant 0019.
-- ---------------------------------------------------------------------------------------------

drop trigger if exists imputation_paiement_verrouiller on public.imputation_paiement;
drop function if exists public.imputation_paiement_verrouiller();


-- ---------------------------------------------------------------------------------------------
-- 5. Privilège UPDATE retiré — retour à SELECT, INSERT seuls (état de 0010).
-- ---------------------------------------------------------------------------------------------

revoke all on public.imputation_paiement from dfa_app;
grant  select, insert on public.imputation_paiement to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 6. FK retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.imputation_paiement
  drop constraint if exists imputation_paiement_fk_export;


-- ---------------------------------------------------------------------------------------------
-- 7. Colonnes retirées — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.imputation_paiement
  drop column if exists export_id,
  drop column if exists exporte_le;
