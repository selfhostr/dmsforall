-- =============================================================================================
-- 0042_ventes_financement_montants.down.sql — annulation de
-- 0042_ventes_financement_montants.sql
--
-- Ordre inverse du up : commentaire de table restauré au texte exact de 0032, puis les six CHECK,
-- puis les cinq colonnes. Migration de DONNÉES : aucune — les colonnes n'ont jamais porté que des
-- NULL sur toute installation qui n'a pas encore de code applicatif les écrivant (voir assertion
-- finale du up), donc aucune perte d'information possible à ce DROP COLUMN dans le cas général ;
-- si des lignes réelles ont depuis été saisies avec ces montants, ce down les perd bel et bien —
-- même arbitrage assumé que 0034 pour `motif_annulation`.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0032.
-- ---------------------------------------------------------------------------------------------

comment on table public.financement_vente is
  'Financement/leasing d''un dossier de vente (RV-39→RV-45). PLUSIEURS lignes possibles par '
  'dossier (append-only côté remplacement, CV-03 : un financement refusé est TERMINAL, jamais '
  'rouvert — un nouveau mode de financement est une NOUVELLE ligne). Le "financement courant" '
  '(contrats/ventes/financement.ts::FinancementResume) est une notion DE LECTURE (le plus récent '
  'non refusé, ou le plus récent tout court) — aucun drapeau "actif" stocké, le contrat n''en '
  'expose aucun. Machine à états (entite=''financement_vente'') + verifier_transition() — '
  'dispositif générique de 0003. Auditée.';


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK retirées.
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  drop constraint if exists financement_vente_comptant_sans_detail_chk;

alter table public.financement_vente
  drop constraint if exists financement_vente_duree_chk;

alter table public.financement_vente
  drop constraint if exists financement_vente_taux_interet_chk;

alter table public.financement_vente
  drop constraint if exists financement_vente_mensualite_chk;

alter table public.financement_vente
  drop constraint if exists financement_vente_acompte_chk;

alter table public.financement_vente
  drop constraint if exists financement_vente_montant_finance_chk;


-- ---------------------------------------------------------------------------------------------
-- 3. Colonnes retirées — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.financement_vente
  drop column if exists duree_mois,
  drop column if exists taux_interet_pourmille,
  drop column if exists mensualite_centimes,
  drop column if exists acompte_centimes,
  drop column if exists montant_finance_centimes;
