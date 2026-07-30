-- =============================================================================================
-- 0013_ordre_reparation_numero_recherche.down.sql — annulation de
-- 0013_ordre_reparation_numero_recherche.sql
--
-- Supprime UNIQUEMENT l'index créé par 0013, rien d'autre : redonne à la recherche par numéro
-- d'OR son comportement d'avant (balayage complet du tenant), volontairement — down annule la
-- CORRECTION, pas un bug (même logique que 0012.down).
-- =============================================================================================

drop index if exists public.ordre_reparation_numero_recherche_idx;
