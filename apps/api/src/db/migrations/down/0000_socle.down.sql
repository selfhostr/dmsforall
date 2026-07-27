-- =============================================================================================
-- 0000_socle.down.sql — annulation de 0000_socle.sql
--
-- ATTENTION : DESTRUCTIF. Ce script supprime les tables du socle et donc toutes les données
-- qu'elles contiennent — tenants, sites, comptes utilisateurs, journal de sécurité.
-- Réservé au développement et à la CI (base éphémère). Sur une base réelle, il n'a de sens
-- qu'après une sauvegarde vérifiée, et jamais comme réaction à chaud à un incident.
--
-- Prérequis : appliquer d'abord 0001_socle_rls.down.sql (le schéma `amorcage` référence ces
-- tables ; `drop table` échouerait sur les dépendances).
--
-- L'ordre suit l'inverse des dépendances de clés étrangères : journal_securite et session
-- pointent vers utilisateur, qui pointe vers tenant.
-- =============================================================================================

drop table if exists public.journal_securite;
drop table if exists public.session;
drop table if exists public.utilisateur;
drop table if exists public.site;
drop table if exists public.tenant;

-- Les triggers disparaissent avec leurs tables ; la fonction, elle, est indépendante.
drop function if exists public.touche_modifie_le();

drop type if exists type_evenement_securite;
drop type if exists role_utilisateur;
drop type if exists statut_utilisateur;
drop type if exists statut_tenant;
drop type if exists langue;
