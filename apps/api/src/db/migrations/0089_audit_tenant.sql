-- =============================================================================================
-- 0089_audit_tenant.sql — `entite_auditee` gagne `tenant` : le changement de raison sociale du
-- garage (PATCH /parametres-entreprise) est journalisé dans audit_atelier (avant/après).
--
-- Pas de trigger générique ici : `auditer_atelier()` lit `new.tenant_id`, que la table `tenant`
-- n'a pas (sa clé est `id`). Le service écrit donc la ligne d'audit lui-même, dans la même
-- transaction que l'UPDATE. Seule la valeur d'enum est posée par cette migration.
--
-- Réversibilité : PostgreSQL n'a pas de DROP VALUE ; le down est volontairement vide
-- (même limite que 0023/0031, voir scripts/verifier-reversibilite-migrations.sh).
-- =============================================================================================

alter type public.entite_auditee add value if not exists 'tenant';
