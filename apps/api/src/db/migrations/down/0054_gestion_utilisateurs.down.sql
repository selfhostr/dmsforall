-- =============================================================================================
-- 0054_gestion_utilisateurs.down.sql — inverse de 0054_gestion_utilisateurs.sql.
--
-- Ordre inverse du up : `audit_utilisateur` et `utilisateur_site` n'ont aucune dépendance entre
-- elles (ordre arbitraire), puis le type enum utilisé par `audit_utilisateur`.
--
-- Réversible intégralement : les deux tables n'ont jamais existé avant ce up (aucune ligne à
-- perdre), aucune colonne d'une table préexistante n'a été touchée.
-- =============================================================================================

drop table public.audit_utilisateur;
drop table public.utilisateur_site;

drop type public.action_audit_utilisateur;
