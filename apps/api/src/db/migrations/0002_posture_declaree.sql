-- =============================================================================================
-- 0002_posture_declaree.sql — préalable à l'étape 1 : déclarer les écarts au lieu de les tolérer
--
-- Deux trous, tous deux constatés en exécution sur la base de développement avant d'écrire cette
-- migration, et tous deux voués à s'ouvrir à la première table de l'étape 1 :
--
--   TROU 1 — la table sans `tenant_id` passe le contrôle de démarrage sans rien dire.
--     `verifierPostureRls()` n'exige une politique isolante que des tables PORTANT `tenant_id`.
--     Une table métier à laquelle on oublie `tenant_id`, avec la politique du socle recopiée
--     bêtement (`to dfa_app using (true) with check (true)`, le motif légitime de dfa_migrator),
--     démarre l'API sans un seul avertissement — et dfa_app y lit, y écrit et en supprime toutes
--     les lignes SANS aucun contexte tenant. Vérifié : table de test à 1 ligne, INSERT accepté
--     hors `enTenant()`, SELECT visible, DELETE accepté.
--     L'étape 1 introduit de vrais référentiels sans `tenant_id` (`transition_autorisee`, motifs,
--     marques). Ils sont légitimes — mais s'ils passent par OMISSION, la première table métier à
--     laquelle on oubliera `tenant_id` passera pour un référentiel.
--
--   TROU 2 — `DELETE` est accordé par défaut à toute nouvelle table.
--     Le filet `alter default privileges … grant select, insert, update, delete` posé en 0001 §3
--     donne `DELETE` à dfa_app sur CHAQUE table créée ensuite par dfa_migrator (vérifié : table
--     de test créée sans aucun GRANT → dfa_app y a DELETE). La règle « rien n'est physiquement
--     supprimé » (documents de vente, mouvements de stock, pointages) reposerait alors sur un
--     `revoke delete` à ne pas oublier dans chacune des ~30 migrations à venir. Une règle qui
--     dépend de la discipline n'est pas une règle : c'est un pari, et on le perd une fois.
--
-- Le principe retenu, unique pour les deux : ce qui déroge se DÉCLARE, dans le commentaire de la
-- table, et le contrôle de démarrage VÉRIFIE que la déclaration correspond aux privilèges réels.
-- Une déclaration n'accorde donc rien — elle décrit une posture, et si la posture ne suit pas,
-- l'API refuse de démarrer malgré la déclaration.
--
-- Pourquoi le commentaire de table plutôt qu'une liste blanche en code ou une table de registre :
--   - il vit dans la MÊME migration que le `create table`, donc dans le même commit, sous les
--     yeux du même relecteur. Une liste blanche en TypeScript peut diverger de la base ; le
--     commentaire EST la base ;
--   - poser un commentaire exige d'être PROPRIÉTAIRE de la table, donc d'être dfa_migrator.
--     dfa_app ne peut pas s'auto-déclarer une exception, même compromis. Une table de registre,
--     elle, se remplit par un simple INSERT ;
--   - il survit aux dumps/restaurations et se lit en une requête (`\d+`, obj_description), donc
--     un audit sur la base de production répond à la question sans lire le code ;
--   - il ne crée aucun objet, aucune dépendance d'amorçage, et se retire par un `comment … is`.
-- Une convention de nommage (préfixe `ref_`) a été écartée : un nom n'est pas une déclaration,
-- personne ne le relit comme un engagement, et il suffit d'appeler une table `ref_ligne_or` pour
-- lui ouvrir la porte.
--
-- Vocabulaire des marqueurs (la grammaire est `[dfa:<motif>]`, n'importe où dans le commentaire ;
-- tout marqueur `[dfa:…]` inconnu fait échouer le démarrage, pour qu'une faute de frappe ne se
-- traduise pas par une déclaration silencieusement absente) :
--
--   [dfa:referentiel-partage]   table sans `tenant_id`, identique pour tous les tenants.
--                               Vérifié : dfa_app y a SELECT et RIEN d'autre.
--   [dfa:hors-portee-app]       table sans `tenant_id` sur laquelle dfa_app n'a AUCUN privilège
--                               (infrastructure : suivi de migrations). Vérifié : zéro privilège.
--   [dfa:suppression-physique]  dfa_app a le droit de DELETE sur cette table. Vérifié nulle part
--                               ailleurs : sans ce marqueur, DELETE fait échouer le démarrage.
--
-- Chaque marqueur exige une justification en clair dans le même commentaire (au moins 15
-- caractères hors marqueurs) : un `comment on table x is '[dfa:referentiel-partage]'` posé à la
-- va-vite est refusé.
--
-- Aucune table n'est créée, supprimée ni modifiée ici : cette migration ne touche que des
-- privilèges et des commentaires. Réversible : migrations/down/0002_posture_declaree.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Retirer DELETE des privilèges accordés par défaut aux futures tables
--
-- C'est le correctif structurel du TROU 2 : la valeur par défaut devient celle qu'on veut voir
-- partout, et les rares tables qui ont besoin de DELETE l'obtiennent par un GRANT explicite
-- accompagné de son marqueur. On inverse la charge : ce n'est plus « ne pas oublier de retirer »
-- (silencieux quand on oublie) mais « demander explicitement » (visible en revue).
--
-- SELECT/INSERT/UPDATE restent au défaut, volontairement. Le raisonnement de 0001 §3 tient
-- toujours : une table créée sans GRANT resterait invisible à l'application, ce qui produit une
-- panne obscure ; et le RLS, lui, refuse déjà tout tant qu'aucune politique n'est posée.
--
-- ATTENTION, propriété de `alter default privileges` : elle N'EST PAS rétroactive. Elle ne
-- change rien aux tables déjà créées — d'où la section 2.
-- ---------------------------------------------------------------------------------------------

alter default privileges for role dfa_migrator in schema public
  revoke delete on tables from dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 2. Déclarer les exceptions du socle
--
-- AVANT la section 3, et l'ordre est porteur de sens : on déclare d'abord ce qui doit survivre,
-- on aligne ensuite. L'inverse retirerait DELETE à `session` (qui ne porte pas encore son
-- marqueur) avant de le déclarer — c'est-à-dire casserait la déconnexion et la purge des sessions
-- au passage. C'est exactement le genre d'ordre qu'une migration de durcissement doit poser une
-- fois pour toutes.
--
-- `comment on table` REMPLACE le commentaire, il ne l'ajoute pas : le texte de 0000 est donc
-- recopié ici en entier. On ne modifie pas 0000, qui est appliquée et immuable (le runner en
-- vérifie l'empreinte).
-- ---------------------------------------------------------------------------------------------

-- `session` est la seule table du socle où DELETE est légitime : la purge des sessions expirées
-- et la révocation suppriment réellement la ligne. Y garder une session révoquée n'apporterait
-- aucune valeur d'audit — `journal_securite`, lui, garde la trace de la déconnexion — et
-- laisserait traîner une empreinte de jeton, c'est-à-dire un secret dérivé.
comment on table public.session is
  'Sessions authentifiées. Ne contient que l''empreinte SHA-256 du jeton, jamais le jeton. '
  '[dfa:suppression-physique] La purge des sessions expirées et la révocation suppriment '
  'physiquement la ligne : conserver une empreinte de jeton révoqué serait garder un secret '
  'dérivé sans contrepartie d''audit (la déconnexion est tracée dans journal_securite).';

-- Les autres tables du socle portent `tenant_id` (ou sont `tenant`) et n'ont besoin d'aucune
-- déclaration : elles suivent le motif standard, vérifié par verifierPostureRls().
-- `__dfa_migrations` n'est pas créée par une migration mais par le runner lui-même, qui pose son
-- marqueur `[dfa:hors-portee-app]` au même endroit que son `revoke all` (voir migrer.ts).


-- ---------------------------------------------------------------------------------------------
-- 3. Aligner les tables DÉJÀ existantes
--
-- Boucle plutôt que liste en dur, pour deux raisons :
--   - elle est idempotente et auto-réparatrice : une base restaurée depuis un dump antérieur, ou
--     retouchée à chaud pendant un incident, revient à la posture attendue en rejouant ceci ;
--   - elle rend le marqueur opérant DÈS cette migration, au lieu d'attendre que le contrôle de
--     démarrage l'utilise. La déclaration et l'application de la déclaration sont posées
--     ensemble, pas à deux endroits qui pourraient diverger.
--
-- Non destructive : on ne retire qu'un privilège, jamais une ligne. Sur cette base, la seule
-- table concernée est `session` — qui porte désormais son marqueur (section 2) et conserve donc
-- DELETE. La section 4 le vérifie et fait échouer la migration si ce n'était pas le cas.
--
-- `relkind in ('r','p')` inclut les tables PARTITIONNÉES, et les partitions elles-mêmes sont des
-- relations 'r' : chacune est traitée pour son propre compte, comme il se doit — une partition
-- n'hérite pas de la posture de sa mère (mesuré, voir acces-base.service.ts).
--
-- `has_table_privilege` et non `information_schema` : on veut le privilège EFFECTIF de dfa_app,
-- héritages de rôles et privilèges accordés à PUBLIC compris. C'est ce que le contrôle de
-- démarrage regarde, et les deux doivent juger la même chose.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as tbl
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')                       -- tables ordinaires ET partitionnées
       and has_table_privilege('dfa_app', c.oid, 'DELETE')
       and coalesce(obj_description(c.oid, 'pg_class'), '')
             not like '%[dfa:suppression-physique]%'
  loop
    raise notice 'Retrait de DELETE sur % (aucun marqueur [dfa:suppression-physique])', r.tbl;
    execute format('revoke delete on %s from dfa_app', r.tbl);
  end loop;
end
$$;


-- ---------------------------------------------------------------------------------------------
-- 4. Assertion de fin de migration
--
-- Le contrôle complet vit dans `ServiceAccesBase.verifierPostureRls()` (au démarrage de l'API,
-- depuis la connexion dfa_app réellement utilisée — c'est le seul point de vue qui prouve
-- quelque chose). Ce qui suit n'est pas une duplication de ce contrôle : c'est l'assertion que
-- CETTE migration a fait ce qu'elle annonce, échouée dans la transaction de la migration plutôt
-- que découverte au déploiement suivant.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fautives text;
begin
  -- 4.1 Plus aucune table non déclarée ne laisse DELETE à dfa_app.
  select string_agg(c.oid::regclass::text, ', ' order by c.oid::regclass::text)
    into fautives
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('dfa_app', c.oid, 'DELETE')
     and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%[dfa:suppression-physique]%';

  if fautives is not null then
    raise exception 'DELETE subsiste pour dfa_app sur % sans marqueur [dfa:suppression-physique].', fautives;
  end if;

  -- 4.2 `session` doit AVOIR conservé DELETE : la boucle §2 ne doit pas avoir emporté le seul
  -- cas légitime. Une migration de durcissement qui casse la déconnexion serait pire que le
  -- problème qu'elle corrige.
  if not has_table_privilege('dfa_app', 'public.session', 'DELETE') then
    raise exception 'session a perdu DELETE : la purge des sessions et la révocation seraient cassées.';
  end if;

  -- 4.3 TRUNCATE, nulle part, sans exception possible. TRUNCATE ignore intégralement les
  -- politiques RLS : un seul ordre viderait la table de TOUS les tenants à la fois. Aucun besoin
  -- applicatif ne le justifie, donc aucun marqueur ne l'autorise.
  select string_agg(c.oid::regclass::text, ', ' order by c.oid::regclass::text)
    into fautives
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and has_table_privilege('dfa_app', c.oid, 'TRUNCATE');

  if fautives is not null then
    raise exception 'dfa_app détient TRUNCATE sur % : TRUNCATE contourne le RLS et viderait tous les tenants.', fautives;
  end if;
end
$$;
