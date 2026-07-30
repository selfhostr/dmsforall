-- =============================================================================================
-- 0020_document_vente_numero_recherche.down.sql — annulation de
-- 0020_document_vente_numero_recherche.sql
--
-- Un seul objet créé par le up : l'index. Aucune donnée, aucune colonne, aucun privilège
-- touché — la migration inverse se limite à le retirer.
-- =============================================================================================

drop index if exists public.document_vente_numero_recherche_trgm_idx;
