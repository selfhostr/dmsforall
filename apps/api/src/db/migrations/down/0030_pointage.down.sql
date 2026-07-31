-- =============================================================================================
-- 0030_pointage.down.sql — inverse de 0030_pointage.sql.
--
-- RÉVERSIBILITÉ PARTIELLE, comme 0010/0016/0022/0023 : `alter type entite_auditee add value
-- 'periode_pointage'` (§2 de la montante) N'EST PAS DÉFAIT — PostgreSQL n'offre aucun `DROP
-- VALUE` sur un type enum existant. Tout le reste (tables, triggers, fonctions, contenu du
-- référentiel de transitions, enums NOUVEAUX créés par cette migration) est défait ci-dessous.
-- Enregistrée dans scripts/verifier-reversibilite-migrations.sh (EXCEPTIONS_DOWN_PARTIEL), même
-- famille que 0010/0016/0022/0023.
-- =============================================================================================

drop table public.pointage_verrouillage_site;

delete from public.transition_autorisee where entite = 'pointage';

drop table public.pointage;

drop function public.pointage_interdire_suppression();

drop type public.motif_anomalie_pointage;
drop type public.activite_indirecte_pointage;
