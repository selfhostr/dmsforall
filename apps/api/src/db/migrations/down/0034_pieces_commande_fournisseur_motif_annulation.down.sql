-- =============================================================================================
-- 0034_pieces_commande_fournisseur_motif_annulation.down.sql — annulation de
-- 0034_pieces_commande_fournisseur_motif_annulation.sql
--
-- Ordre inverse du up : commentaire de table restauré au texte exact de 0024, puis CHECK, puis
-- colonne. Aucun trigger d'audit à retirer (contrairement à 0033) : `commande_fournisseur` était
-- déjà auditée avant cette migration, ce down ne touche pas à ce dispositif. Migration de
-- DONNÉES : aucune — la colonne n'a jamais porté que des NULL (voir assertion §3 du up), donc
-- aucune perte d'information possible à ce DROP COLUMN.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Commentaire de table restauré au texte exact de 0024.
-- ---------------------------------------------------------------------------------------------

comment on table public.commande_fournisseur is
  'Commande fournisseur (RP-26→RP-31). Machine à états portée par transition_autorisee '
  '(entite=''commande_fournisseur'') + verifier_transition() — dispositif générique de '
  '0003_prealables_etape1.sql, pas une réimplémentation. Auditée (RP-31).';


-- ---------------------------------------------------------------------------------------------
-- 2. CHECK retirée.
-- ---------------------------------------------------------------------------------------------

alter table public.commande_fournisseur
  drop constraint if exists commande_fournisseur_annulation_coherente_chk;


-- ---------------------------------------------------------------------------------------------
-- 3. Colonne retirée — dernière étape, symétrique de la première étape du up.
-- ---------------------------------------------------------------------------------------------

alter table public.commande_fournisseur
  drop column if exists motif_annulation;
