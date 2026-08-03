-- =============================================================================================
-- 0035_pointage_verrouillage_site_id_et_grant_sequence_article.sql — deux défauts réels révélés
-- par des tests d'intégration jamais exécutés jusqu'ici (`test/lot2/**` absent de
-- `vitest.config.ts`, corrigé séparément) et CONFIRMÉS EN RÉEL — appels HTTP contre l'API tournant
-- en local (pas seulement en test), logs Postgres à l'appui :
--
--  1. `POST /pointages/verrouiller-periode` répondait HTTP 500. L'INSERT dans
--     `pointage_verrouillage_site` déclenche `pointage_verrouillage_site_audit` ->
--     `auditer_atelier('periode_pointage')` (0004 §4), qui référence `NEW.id`/`OLD.id` — cette
--     table n'a PAS de colonne `id`, sa PK est composite `(tenant_id, site_id)`. Erreur observée,
--     mot pour mot, dans le log Postgres :
--       ERROR:  record "new" has no field "id"
--       CONTEXT: ... PL/pgSQL function auditer_atelier() line 14 at SQL statement
--       STATEMENT: insert into "pointage_verrouillage_site" (...) on conflict ("tenant_id","site_id") ...
--
--  2. `POST /articles` répondait HTTP 500. `attribuer_numero_article()` (0022 §3, SECURITY
--     INVOKER — le défaut, explicite) appelle `nextval('public.article_numero_seq')` avec les
--     droits de l'appelant (`dfa_app`), qui n'a jamais reçu GRANT sur cette séquence (oubli à sa
--     création, 0022). Erreur observée :
--       ERROR:  permission denied for sequence article_numero_seq
--       CONTEXT: PL/pgSQL function attribuer_numero_article() line 4 at assignment
--
-- ---------------------------------------------------------------------------------------------
-- ARBITRAGE DÉFAUT 1 — trois options posées, tranchées ici :
--
--   a) Rendre `auditer_atelier()` tolérante à une table sans `id` (colonne d'identité
--      configurable via un second argument de trigger) : REJETÉ. Le défaut ne vient pas d'une
--      fonction trop rigide : `pointage_verrouillage_site` est la SEULE table, parmi les ~20
--      auditées par ce trigger générique (`grep -c "execute function public.auditer_atelier("
--      migrations/*.sql`), à ne pas porter une colonne `id` unique en PK. Élargir un dispositif
--      central — partagé par TOUTES les entités sensibles du projet (documents de vente, OR,
--      mouvements de stock, commandes fournisseur...) — pour absorber l'écart d'UNE seule table
--      déplace le risque de régression vers 20 tables qui fonctionnaient déjà correctement, pour
--      un gain qui ne sert qu'un seul cas réel à ce jour.
--
--   b) Détacher le trigger d'audit de cette table : REJETÉ SANS discussion approfondie. L'audit
--      d'un geste de verrouillage/déverrouillage de période de pointage (qui, quand, quel motif
--      de contre-passation — RM-95) est une exigence du projet (CONTRIBUTING.md : « Audit trail sur les
--      entités sensibles »), pas une option de confort. L'en-tête de `verrouillage-site.ts` le dit
--      d'ailleurs explicitement : « Audité sous l'entité periode_pointage ».
--
--   c) Donner un `id` technique à `pointage_verrouillage_site` — RETENU. PRÉCÉDENT DÉJÀ POSÉ dans
--      CE MÊME dépôt : `tenant_bloc_creancier` (0014) est EXACTEMENT dans la même situation — un
--      singleton par tenant, `unique(tenant_id)` comme clé métier réelle — et porte pourtant un
--      `id uuid` technique en PK, précisément pour s'insérer sans adaptation dans
--      `auditer_atelier()`. `pointage_verrouillage_site` s'écarte de ce patron déjà établi : c'est
--      cet écart qui est la cause du défaut, pas une lacune du dispositif générique. Correctif :
--        - ajouter `id` (uuid, `default gen_random_uuid()`), le promouvoir PK ;
--        - porter l'invariant « une ligne par site » (jusqu'ici assuré par la PK composite) par un
--          `UNIQUE(tenant_id, site_id)` — un déplacement de mécanisme, pas un abandon de
--          l'invariant.
--      `ON CONFLICT (tenant_id, site_id)` côté service (`service-verrouillage-periode.ts`,
--      NON MODIFIÉ ici — hors périmètre, et rien n'exige de le toucher) continue de fonctionner À
--      L'IDENTIQUE : Postgres résout une clause `ON CONFLICT (cols)` contre N'IMPORTE QUEL index
--      unique portant exactement ces colonnes, PK ou pas (doc Postgres, « inference specification
--      »). Aucune FK ne référence cette table (vérifié : aucun
--      `references public.pointage_verrouillage_site` dans tout le schéma) — le remplacement de PK
--      est donc sans effet de bord ailleurs. Table à une ligne par site (jamais de pagination,
--      volumétrie négligeable même à 200 tenants) : le réécriture de table déclenchée par
--      `ADD COLUMN ... DEFAULT gen_random_uuid()` (valeur volatile, pas d'optimisation du défaut
--      rapide de PG11+) est sans coût mesurable.
--
-- ---------------------------------------------------------------------------------------------
-- ARBITRAGE DÉFAUT 2 : `GRANT USAGE, SELECT` sur la séquence à `dfa_app` (et `dfa_migrator`, par
-- symétrie avec le patron déjà suivi pour les fonctions — `grant execute ... to dfa_app,
-- dfa_migrator`, 0022 §3 — bien que `dfa_migrator` en ait déjà l'usage de fait comme propriétaire
-- du schéma `public`, 01-roles.sql). `USAGE` seul suffit à `nextval()`/`currval()` ; `SELECT`
-- ajoute la lecture directe de l'état de la séquence (diagnostic). `UPDATE` (donnant `setval()`)
-- délibérément PAS accordé : aucun endpoint applicatif ne doit pouvoir réinitialiser la
-- numérotation des articles.
--
-- CORRECTIF NE VA PAS DANS `docker/postgres/init/01-roles.sql` : ce fichier ne pose QUE les droits
-- par défaut sur le schéma (commentaire d'en-tête de 01-roles.sql, « Les GRANT fins par table sont
-- posés par les migrations ») et ne rejoue de toute façon que sur un volume Postgres VIDE
-- (`docker compose down -v` requis) — inutile ici, sans objet pour les bases déjà provisionnées.
-- Le correctif complet, pour les bases neuves ET existantes, est cette migration.
--
-- RECHERCHE DEMANDÉE DES AUTRES SÉQUENCES PORTANT LE MÊME DÉFAUT : `article_numero_seq`
-- (`grep -n "create sequence" migrations/*.sql`) est LA SEULE séquence Postgres de tout le schéma.
-- La numérotation des documents de vente/OR (`compteur_document`, 0010 §3) passe par une TABLE
-- compteur verrouillée en transaction (`select ... for update`), pas par un objet `SEQUENCE` —
-- aucune autre séquence n'existe donc pour reproduire cet oubli.
--
-- Réversible intégralement — aucun `alter type ... add value` dans cette migration (à la
-- différence de 0010/0016/0022/0023/0030, famille EXCEPTIONS_DOWN_PARTIEL) :
-- migrations/down/0035_pointage_verrouillage_site_id_et_grant_sequence_article.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `pointage_verrouillage_site` — id technique, PK déplacée, invariant repris par UNIQUE
-- ---------------------------------------------------------------------------------------------

alter table public.pointage_verrouillage_site
  add column id uuid not null default gen_random_uuid();

comment on column public.pointage_verrouillage_site.id is
  'Identité technique ajoutée par 0035 — seul rôle : permettre à '
  'auditer_atelier(''periode_pointage'') de renseigner audit_atelier.entite_id (NEW.id/OLD.id), '
  'exactement comme tenant_bloc_creancier (0014). L''identité MÉTIER de la ligne reste '
  '(tenant_id, site_id) : voir pointage_verrouillage_site_tenant_site_uk, ci-dessous.';

alter table public.pointage_verrouillage_site
  drop constraint pointage_verrouillage_site_pk;

alter table public.pointage_verrouillage_site
  add constraint pointage_verrouillage_site_pk primary key (id);

-- Reprend EXACTEMENT l'invariant que portait la PK composite jusqu'ici (« au plus une ligne par
-- site ») : ON CONFLICT (tenant_id, site_id) côté service continue de se résoudre contre cet
-- index unique, sans changement applicatif.
alter table public.pointage_verrouillage_site
  add constraint pointage_verrouillage_site_tenant_site_uk unique (tenant_id, site_id);


-- ---------------------------------------------------------------------------------------------
-- 2. `article_numero_seq` — GRANT oublié à la création (0022 §3)
-- ---------------------------------------------------------------------------------------------

grant usage, select on sequence public.article_numero_seq to dfa_app, dfa_migrator;


-- ---------------------------------------------------------------------------------------------
-- 3. Auto-vérification — mêmes patrons que 0016/0022/0033
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 3.1 La PK de pointage_verrouillage_site est désormais à une seule colonne (id).
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.pointage_verrouillage_site'::regclass
       and contype = 'p'
       and conname = 'pointage_verrouillage_site_pk'
       and array_length(conkey, 1) = 1
  ) then
    raise exception '0035 : pointage_verrouillage_site_pk n''est pas une PK à une seule colonne après migration.';
  end if;

  -- 3.2 L'invariant « une ligne par site » reste porté par un UNIQUE(tenant_id, site_id).
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.pointage_verrouillage_site'::regclass
       and contype = 'u'
       and conname = 'pointage_verrouillage_site_tenant_site_uk'
  ) then
    raise exception '0035 : pointage_verrouillage_site_tenant_site_uk absente après migration.';
  end if;

  -- 3.3 dfa_app peut désormais tirer un numéro depuis article_numero_seq.
  if not has_sequence_privilege('dfa_app', 'public.article_numero_seq', 'USAGE') then
    raise exception '0035 : dfa_app n''a toujours pas USAGE sur article_numero_seq.';
  end if;
end
$$;
