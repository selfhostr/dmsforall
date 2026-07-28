-- =============================================================================================
-- 0002_posture_declaree.down.sql — annulation de 0002_posture_declaree.sql
--
-- Restaure l'état de 0001 : DELETE revient dans les privilèges par défaut des futures tables, et
-- le commentaire de `session` retrouve son texte d'origine (sans marqueur).
--
-- ATTENTION : après ce script, toute nouvelle table redonne DELETE à dfa_app, et une table sans
-- `tenant_id` redevient acceptable sans déclaration. À n'exécuter que pour revenir à une version
-- de l'API antérieure au contrôle correspondant — jamais comme réaction à un démarrage refusé.
-- Un démarrage refusé signale un vrai écart de posture : la correction est dans la migration
-- fautive, pas ici.
--
-- Aucune donnée n'est perdue : ce script ne touche que des privilèges et un commentaire.
-- Non réversible en un sens : les tables créées ENTRE l'application et l'annulation de 0002
-- n'ont pas reçu DELETE et ne le récupèrent pas — c'est voulu, leur en redonner serait une
-- régression de sécurité déguisée en retour arrière.
-- À exécuter avec dfa_migrator, dans une transaction.
-- =============================================================================================

-- --- 1. Privilèges par défaut ------------------------------------------------------------------
-- Remet exactement la clause de 0001 §3.
alter default privileges for role dfa_migrator in schema public
  grant delete on tables to dfa_app;

-- --- 2. Privilèges des tables existantes -------------------------------------------------------
-- `session` est la seule table à laquelle 0002 §2 aurait pu retirer DELETE, et elle l'a conservé
-- (marqueur). Rien à rendre : on se contente de garantir l'invariant d'origine.
grant delete on public.session to dfa_app;

-- --- 3. Commentaire ----------------------------------------------------------------------------
-- Texte strictement identique à celui posé par 0000_socle.sql.
comment on table public.session is
  'Sessions authentifiées. Ne contient que l''empreinte SHA-256 du jeton, jamais le jeton.';
