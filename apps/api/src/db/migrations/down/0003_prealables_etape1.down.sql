-- =============================================================================================
-- 0003_prealables_etape1.down.sql — annulation de 0003_prealables_etape1.sql
--
-- Ramène la base à l'état 0002 : plus d'extensions de recherche, plus de fonction de
-- normalisation, plus de référentiel de transitions, plus de garde-fou générique.
--
-- ORDRE : exactement l'inverse de la montée, en une seule transaction. Les types enum sont
-- supprimés en DERNIER parce que la table et les fonctions en dépendent.
--
-- CE QUE CE SCRIPT DÉTRUIT : le contenu de `transition_autorisee` (27 lignes). Ce n'est pas une
-- perte de données au sens métier — ce contenu appartient à la migration, pas au garage, et
-- rejouer 0003 le restitue à l'identique. Aucune donnée saisie par un utilisateur n'est touchée.
--
-- CE QUE CE SCRIPT NE PEUT PAS FAIRE, et c'est voulu : si une migration ULTÉRIEURE (0004→0008)
-- est encore appliquée, ce script ÉCHOUE — un index d'expression sur
-- `normaliser_recherche()`, une contrainte EXCLUDE sur btree_gist, une colonne
-- `statut_ordre_reparation` ou un trigger `verifier_transition()` dépendent de ces objets.
-- Aucun `cascade` n'est employé nulle part ici : un `drop … cascade` supprimerait ces index et
-- ces triggers en silence, laissant une base qui démarre, répond, et n'applique plus aucune
-- règle de transition. L'échec est le bon comportement — annuler 0003 exige d'avoir annulé
-- 0004→0008 d'abord.
--
-- À exécuter avec dfa_migrator, dans une transaction.
-- =============================================================================================

-- --- 1. Garde-fou générique -------------------------------------------------------------------
-- Aucun trigger n'est posé par 0003 (les tables métier n'existaient pas encore). Si une
-- migration ultérieure en a posé, ce drop échoue faute de `cascade` : voir l'en-tête.
drop function if exists public.verifier_transition();

-- --- 2. Référentiel des transitions ------------------------------------------------------------
-- Le trigger de validation de contenu tombe avec la table ; sa fonction, non.
drop table    if exists public.transition_autorisee;
drop function if exists public.transition_autorisee_valide_contenu();

-- --- 3. Types enum -----------------------------------------------------------------------------
-- Après la table et les fonctions qui les référencent.
drop type if exists public.statut_ligne_or;
drop type if exists public.statut_ordre_reparation;
drop type if exists public.action_auditee;
drop type if exists public.entite_auditee;

-- --- 4. Normalisation de recherche ---------------------------------------------------------------
drop function if exists public.normaliser_recherche(text);

-- --- 5. Extensions -------------------------------------------------------------------------------
-- `unaccent` en premier : la fonction de normalisation vient d'être supprimée, plus rien n'en
-- dépend. Sans `cascade`, chacun de ces drops échoue si un index d'une migration ultérieure
-- utilise encore l'opérateur ou le dictionnaire — exactement le filet décrit en en-tête.
--
-- NOTE D'EXPLOITATION : sur une base fournie par l'hébergeur, ces extensions peuvent avoir été
-- installées AVANT 0003 (`create extension if not exists` ne l'aurait pas signalé). Les
-- supprimer ici les retirerait alors qu'elles ne nous appartiennent pas. C'est sans conséquence
-- sur dmsforall — aucun autre composant du produit ne les utilise — et rejouer 0003 les
-- réinstalle.
drop extension if exists unaccent;
drop extension if exists pg_trgm;
drop extension if exists btree_gin;
drop extension if exists btree_gist;
