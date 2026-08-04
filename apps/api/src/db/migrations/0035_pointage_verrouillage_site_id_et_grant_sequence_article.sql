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
--     droits de l'appelant (`dfa_app`), qui n'a jamais reçu de privilège sur cette séquence (oubli
--     à sa création, 0022). Erreur observée :
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
--      volumétrie négligeable même à 200 tenants) : la réécriture de table déclenchée par
--      `ADD COLUMN ... DEFAULT gen_random_uuid()` (valeur volatile, pas d'optimisation du défaut
--      rapide de PG11+) est sans coût mesurable.
--      Réversible INTÉGRALEMENT (table ordinaire, aucune limite de catalogue) : voir down/*.sql.
--
-- ---------------------------------------------------------------------------------------------
-- ARBITRAGE DÉFAUT 2 — DEUX pistes essayées, la première ABANDONNÉE EN COURS DE ROUTE après
-- preuve empirique de son coût caché, remplacée par la seconde :
--
--   PISTE ABANDONNÉE : `GRANT USAGE, SELECT ON SEQUENCE article_numero_seq TO dfa_app`. Fonctionne
--   à l'exécution (vérifié : POST /articles repasse de 500 à 201) mais casse la réversibilité —
--   constaté par `scripts/verifier-reversibilite-migrations.sh`, PAS supposé. Cause, vérifiée
--   empiriquement sur une séquence de test (cycle `create → grant → revoke`, comparaison
--   `pg_dump --schema-only` avant/après) : `pg_class.relacl` d'un objet jamais touché vaut NULL
--   (« ACL par défaut », `pg_dump` n'imprime rien) ; DÈS le premier `GRANT ... TO <non-
--   propriétaire>` sur un objet préexistant, PostgreSQL MATÉRIALISE cette ACL par défaut en
--   tableau explicite, qui inclut alors, DE FAÇON PERMANENTE, les droits du propriétaire
--   (`dfa_migrator=rwU`) — jamais redemandés par cette migration. AUCUN `REVOKE`, même
--   `REVOKE ALL ... FROM dfa_migrator`, ne ramène `relacl` à NULL (vérifié : le résidu subsiste
--   même après un revoke total). Seul un DROP + recreate le pourrait, option elle-même REJETÉE :
--   `article_numero_seq` porte une numérotation déjà EN COURS D'USAGE (RP-08, unique par tenant) ;
--   la recréer réinitialiserait son compteur à 1 et produirait des doublons de numero_article sur
--   les articles déjà en base — bien plus grave qu'un résidu de réversibilité. Corriger le défaut
--   réel (500 en production) en cassant la réversibilité vérifiée d'une autre migration n'est pas
--   un compromis acceptable ici : la piste est abandonnée, pas contournée par une exception.
--
--   PISTE RETENUE : `attribuer_numero_article()` passe de `SECURITY INVOKER` (le défaut, explicite
--   en 0022) à `SECURITY DEFINER`. La fonction s'exécute alors avec les droits de son PROPRIÉTAIRE
--   (`dfa_migrator`, qui possède `article_numero_seq` depuis sa création en 0022 et en a l'usage
--   IMPLICITE tant que personne n'y touche) — plus besoin d'accorder quoi que ce soit à `dfa_app`,
--   et donc plus AUCUNE opération sur l'ACL de la séquence : le problème de matérialisation
--   ci-dessus disparaît intégralement, pas seulement son symptôme.
--   Sûr ici, PAS supposé :
--     - `attribuer_numero_article()` fixe déjà `set search_path = pg_catalog, public` (0022) —
--       la protection standard contre le détournement de search_path d'un SECURITY DEFINER
--       s'applique déjà, sans rien changer.
--     - Corps de fonction entièrement déterministe et sans paramètre : un seul `nextval()` sur un
--       nom PLEINEMENT QUALIFIÉ (`public.article_numero_seq`, jamais résolu via search_path),
--       aucune requête sur une table soumise au RLS — contrairement aux fonctions
--       `amorcage.*` (0001_socle_rls.sql), déjà SECURITY DEFINER dans ce même dépôt pour un motif
--       bien plus sensible (lecture cross-tenant avant authentification), cette fonction-ci
--       n'élève AUCUN accès aux données : elle incrémente un compteur, point.
--     - `dfa_app` n'obtient ainsi RIEN de plus que ce qu'il avait déjà le droit de faire
--       indirectement (créer un `article` — table sur laquelle il a déjà INSERT, sous RLS) : le
--       SECURITY DEFINER ne fait qu'autoriser l'étape interne au trigger, pas une nouvelle
--       capacité côté appelant.
--   RÉVERSIBILITÉ VÉRIFIÉE EMPIRIQUEMENT (pas déduite) : `ALTER FUNCTION ... SECURITY DEFINER`
--   puis `... SECURITY INVOKER` sur une fonction de test, `pg_dump --schema-only` avant/après le
--   cycle complet — AUCUN diff. `prosecdef` est un attribut ordinaire de `pg_proc`, pas une
--   opération additive de catalogue comme `ALTER TYPE ... ADD VALUE` ou une ACL matérialisée :
--   cette migration N'A DONC PLUS BESOIN d'aucune exception dans
--   `scripts/verifier-reversibilite-migrations.sh` (hors périmètre de cet agent — resté INTACT).
--
-- RECHERCHE DEMANDÉE DES AUTRES SÉQUENCES PORTANT LE MÊME DÉFAUT : `article_numero_seq`
-- (`grep -n "create sequence" migrations/*.sql`) est LA SEULE séquence Postgres de tout le schéma.
-- La numérotation des documents de vente/OR (`compteur_document`, 0010 §3) passe par une TABLE
-- compteur verrouillée en transaction (`select ... for update`), pas par un objet `SEQUENCE` —
-- aucune autre séquence n'existe donc pour reproduire cet oubli, et aucune autre fonction
-- `attribuer_numero_*` n'existe qui appellerait `nextval()` sous `SECURITY INVOKER`.
--
-- CORRECTIF NE VA PAS DANS `docker/postgres/init/01-roles.sql` : ce fichier ne pose QUE les droits
-- par défaut sur le schéma et ne rejoue de toute façon que sur un volume Postgres VIDE — sans objet
-- ici, la piste retenue ne touche même plus aux privilèges.
--
-- Réversible INTÉGRALEMENT — aucun `alter type ... add value`, aucune ACL matérialisée (voir
-- ci-dessus) : migrations/down/0035_pointage_verrouillage_site_id_et_grant_sequence_article.down.sql.
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
-- 2. `attribuer_numero_article()` — SECURITY INVOKER -> SECURITY DEFINER (voir arbitrage ci-dessus)
-- ---------------------------------------------------------------------------------------------

alter function public.attribuer_numero_article() security definer;

comment on function public.attribuer_numero_article() is
  'Trigger BEFORE INSERT sur article : attribue numero_article depuis article_numero_seq si '
  'absent (RP-08). Séquence GLOBALE (pas de reset annuel/par tenant, aucune règle métier ne '
  'l''exige) : l''unicité PAR TENANT (contrainte réelle, article_tenant_numero_uk) en découle '
  'trivialement. SECURITY DEFINER depuis 0035 (corrige permission denied for sequence '
  'article_numero_seq sous dfa_app) : s''exécute avec les droits de dfa_migrator, propriétaire de '
  'la séquence depuis sa création — voir 0035 pour le raisonnement complet et pourquoi un GRANT '
  'a été essayé puis abandonné.';


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

  -- 3.3 attribuer_numero_article() est bien SECURITY DEFINER après migration.
  if not exists (
    select 1
      from pg_catalog.pg_proc
     where oid = 'public.attribuer_numero_article()'::regprocedure
       and prosecdef
  ) then
    raise exception '0035 : attribuer_numero_article() n''est pas SECURITY DEFINER après migration.';
  end if;
end
$$;
