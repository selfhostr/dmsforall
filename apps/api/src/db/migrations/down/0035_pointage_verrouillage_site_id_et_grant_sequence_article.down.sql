-- =============================================================================================
-- 0035_pointage_verrouillage_site_id_et_grant_sequence_article.down.sql — inverse de la montante,
-- INTÉGRALEMENT (aucune exception de réversibilité partielle ici : aucun `alter type ... add
-- value`). Restaure exactement l'état précédent, y compris le défaut 1 qu'il réintroduit
-- mécaniquement (une PK composite (tenant_id, site_id) sans colonne id) — c'est le sens même
-- d'un DOWN : revenir au schéma d'avant cette migration, pas une version « améliorée » de l'avant.
-- =============================================================================================

revoke select, usage on sequence public.article_numero_seq from dfa_app, dfa_migrator;

alter table public.pointage_verrouillage_site
  drop constraint pointage_verrouillage_site_tenant_site_uk;

alter table public.pointage_verrouillage_site
  drop constraint pointage_verrouillage_site_pk;

alter table public.pointage_verrouillage_site
  drop column id;

alter table public.pointage_verrouillage_site
  add constraint pointage_verrouillage_site_pk primary key (tenant_id, site_id);
