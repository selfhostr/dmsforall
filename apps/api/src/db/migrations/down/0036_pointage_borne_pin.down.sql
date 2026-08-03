-- =============================================================================================
-- 0036_pointage_borne_pin.down.sql — inverse de 0036_pointage_borne_pin.sql, INTÉGRALEMENT.
--
-- AUCUNE exception de réversibilité partielle : contrairement à 0010/0016/0022/0023/0025/0027/
-- 0030/0031/0033 (toutes obligées d'ajouter une valeur à un enum `entite_auditee` PRÉEXISTANT,
-- que PostgreSQL ne sait pas défaire), cette migration montante N'A TOUCHÉ AUCUN TYPE EXISTANT :
-- `mode_identification_pointage` est un type ENTIÈREMENT NOUVEAU, créé et supprimé ici dans son
-- intégralité — voir décision (B) de l'en-tête montante : aucune valeur ajoutée à
-- `entite_auditee` non plus, par choix délibéré de ne pas brancher `pin_pointage` sur
-- `auditer_atelier()` dans ce premier socle.
--
-- `DROP TABLE public.pin_pointage` emporte avec lui, sans instruction séparée : ses contraintes
-- (PK, FK, UNIQUE, CHECK), son trigger `pin_pointage_touche_modifie_le`, ses politiques RLS
-- (`pin_pointage_isolation_tenant`, `pin_pointage_migrator`) et son commentaire de table — tous
-- des objets DÉPENDANTS de la table elle-même, jamais partagés avec une autre. Aucun `DROP
-- POLICY`/`DROP TRIGGER` explicite n'est donc nécessaire (même style que
-- down/0030_pointage.down.sql : `drop table public.pointage` seul, sans lister ses triggers).
-- =============================================================================================

alter table public.parametre_site
  drop column mode_identification_pointage;

drop table public.pin_pointage;

drop type public.mode_identification_pointage;
