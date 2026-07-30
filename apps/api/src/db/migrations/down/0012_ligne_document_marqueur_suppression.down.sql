-- =============================================================================================
-- 0012_ligne_document_marqueur_suppression.down.sql — annulation de 0012.
--
-- Restaure le commentaire de `ligne_document` exactement tel que posé par 0010_facturation.sql
-- §8, sans le marqueur `[dfa:suppression-physique]`. Ce down annule la CORRECTION, pas le bug :
-- après ce down, l'API refuse de nouveau de démarrer sur cette base tant que 0012 n'est pas
-- réappliquée — c'est le comportement attendu d'un défaire, pas une régression de ce fichier.
-- Aucun privilège n'est touché : DELETE reste accordé à dfa_app (posé par 0010, pas par 0012).
-- =============================================================================================

comment on table public.ligne_document is
  'Ligne d''un document de vente. Figée avec le reste dès que le document parent quitte '
  '''brouillon'' — voir ligne_document_verrouiller_document. §0.2 : prix_unitaire_centimes est un '
  'montant TTC, ht_centimes est le résidu ttc − tva (jamais recalculé séparément).';
