-- =============================================================================================
-- 0049_recherche_index_manquants.down.sql — annulation de 0049_recherche_index_manquants.sql
--
-- Supprime UNIQUEMENT les cinq index créés par 0049, rien d'autre (même doctrine que
-- 0013.down) : redonne aux cinq requêtes concernées leur comportement d'avant (balayage complet
-- du tenant), volontairement — down annule la correction, pas un bug.
--
-- `pg_trgm` N'EST PAS supprimée ici : 0049 ne l'a pas créée (déjà posée par
-- 0003_prealables_etape1.sql, `create extension if not exists pg_trgm`), et l'extension reste
-- utilisée par une dizaine d'autres index trigram du dépôt (0006, 0007, 0013, ...) qui survivent à
-- ce down — la supprimer ici casserait ces index-là, hors du périmètre de cette annulation.
-- =============================================================================================

drop index if exists public.article_designation_recherche_idx;
drop index if exists public.article_reference_principale_recherche_idx;
drop index if exists public.fournisseur_nom_recherche_idx;
drop index if exists public.depot_pneus_code_case_recherche_idx;
drop index if exists public.document_vente_financier_periode_idx;
