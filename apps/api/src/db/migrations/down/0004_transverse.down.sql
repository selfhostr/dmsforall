-- =============================================================================================
-- 0004_transverse.down.sql — annulation de 0004_transverse.sql
--
-- Ramène la base à l'état 0003 : plus d'audit générique, plus d'idempotence, plus d'outbox.
--
-- ORDRE inverse de la montée. Aucun `cascade` : si une migration ultérieure (0005→0008) pose un
-- trigger sur `auditer_atelier()`, le `drop function` échoue — c'est le comportement voulu,
-- annuler 0004 exige d'avoir annulé 0005→0008 d'abord (même discipline que 0003.down).
--
-- `drop table public.audit_atelier` supprime ses 25 partitions avec elle : une table partitionnée
-- et ses partitions ne forment qu'un seul objet du point de vue de DROP (contrairement à
-- l'héritage classique, aucun CASCADE n'est requis ni ajouté ici).
-- =============================================================================================

drop function if exists public.auditer_atelier();

drop table if exists public.evenement_metier;
drop table if exists public.cle_idempotence;
drop table if exists public.audit_atelier;

drop type if exists public.type_evenement_metier;
