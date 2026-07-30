-- =============================================================================================
-- 0024_pieces_commande_fournisseur.down.sql — inverse de 0024_pieces_commande_fournisseur.sql.
--
-- `entite_auditee` gagne `commande_fournisseur` dans 0023 (migration antérieure et séparée, voir
-- son en-tête et celui de 0024), pas ici : rien à défaire de ce côté dans CE down.
-- =============================================================================================

delete from public.transition_autorisee where entite = 'commande_fournisseur';

drop table public.commande_fournisseur_ligne;
drop table public.commande_fournisseur;

drop type public.origine_commande_fournisseur;
drop type public.statut_commande_fournisseur;
