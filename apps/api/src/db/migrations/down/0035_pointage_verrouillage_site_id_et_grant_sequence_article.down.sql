-- =============================================================================================
-- 0035_pointage_verrouillage_site_id_et_grant_sequence_article.down.sql — inverse de la montante,
-- INTÉGRALEMENT. Aucune exception de réversibilité partielle : `attribuer_numero_article()` repasse
-- en `SECURITY INVOKER` (le défaut d'origine, 0022) — `prosecdef` est un attribut ordinaire de
-- `pg_proc`, un aller-retour DEFINER -> INVOKER ne laisse aucun résidu de catalogue (vérifié
-- empiriquement par comparaison `pg_dump --schema-only` avant/après un cycle complet sur une
-- fonction de test, voir l'en-tête de la montante) — contrairement à la piste GRANT sur la
-- séquence, essayée puis abandonnée précisément parce qu'elle, elle, laissait un résidu d'ACL
-- irréductible.
-- =============================================================================================

alter function public.attribuer_numero_article() security invoker;

comment on function public.attribuer_numero_article() is
  'Trigger BEFORE INSERT sur article : attribue numero_article depuis article_numero_seq si '
  'absent (RP-08). Séquence GLOBALE (pas de reset annuel/par tenant, aucune règle métier ne '
  'l''exige) : l''unicité PAR TENANT (contrainte réelle, article_tenant_numero_uk) en découle '
  'trivialement.';

alter table public.pointage_verrouillage_site
  drop constraint pointage_verrouillage_site_tenant_site_uk;

alter table public.pointage_verrouillage_site
  drop constraint pointage_verrouillage_site_pk;

alter table public.pointage_verrouillage_site
  drop column id;

alter table public.pointage_verrouillage_site
  add constraint pointage_verrouillage_site_pk primary key (tenant_id, site_id);
