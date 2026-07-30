-- =============================================================================================
-- 0019_imputation_paiement_export.sql — corrige un trou comptable signalé par l'agent qui vient
-- de livrer l'export des paiements (`service-export-comptable.ts`, hors périmètre `db/`).
--
-- CONSTAT : MD-91 dit « traçabilité de l'export sur chaque document ET chaque paiement », posé
-- en 0010 par une paire `exporte_le`/`export_id` sur `document_vente` ET sur `paiement`. Mais
-- l'ÉVÉNEMENT comptable qui produit une écriture n'est ni le document (immuable, une seule
-- écriture possible) ni le paiement en tant que tel (un encaissement peut rester en attente
-- d'affectation) — c'est l'IMPUTATION : l'acte d'affecter un montant d'un paiement à un document
-- précis (`imputation_paiement`, MD-50/MD-51). Un paiement peut recevoir de NOUVELLES imputations
-- APRÈS avoir été marqué exporté — flux légitime, pas un cas tordu : une avance client
-- (`POST /paiements` sans imputation) s'impute plus tard sur une facture qui n'existait pas
-- encore (`POST /paiements/{id}/imputations`), ou une imputation est abandonnée puis reportée
-- (`POST /paiements/{id}/abandonner`). Le suivi actuel par `paiement.exporte_le` est alors
-- structurellement incapable de dire la vérité : une fois le paiement marqué exporté, ces
-- imputations tardives ne sont plus jamais candidates à l'export — de l'argent a bougé, une
-- écriture existe, la fiduciaire ne la verra jamais. Ça ne se découvre qu'au bouclement.
--
-- ARBITRAGE (@laupernoe, 30.07.2026) : le suivi d'export doit porter sur `imputation_paiement`, pas sur
-- `paiement` — la granularité du suivi doit être celle de l'écriture. L'alternative (interdire
-- toute imputation nouvelle sur un paiement déjà exporté) est écartée : elle casserait le flux de
-- l'avance client pour arranger une limite technique. Cette migration pose SEULEMENT la colonne
-- et son dispositif ; elle ne fait migrer AUCUN service applicatif (voir « HORS PÉRIMÈTRE »).
--
-- 1. FORME DE LA COLONNE — RÉPLIQUE EXACTE DE `paiement`/`document_vente` (0010) :
--    `exporte_le timestamptz null` / `export_id uuid null`, mêmes noms, même nullabilité, même
--    sémantique (« exporte_le is null » = seule condition de non-répétition, jamais une date
--    dérivée). Aucun CHECK de cohérence entre les deux colonnes n'existe sur `paiement` ni
--    `document_vente` (l'écriture des deux colonnes est toujours groupée côté service, jamais
--    l'une sans l'autre) — même choix ici, pas une omission.
--
-- 2. FK — COMPOSITE AVEC LE TENANT, RESTRICT : `imputation_paiement_fk_export` référence
--    `export_comptable (tenant_id, id)`, exactement `paiement_fk_export`/`document_vente_fk_
--    export` (0010 §14). Une FK sur `id` seul permettrait de rattacher l'imputation d'un tenant A
--    au lot d'export d'un tenant B — règle n°1 du projet. `export_comptable` existe déjà depuis
--    0010 : contrairement à `paiement_fk_export`/`document_vente_fk_export`, qui attendaient sa
--    création plus loin dans LA MÊME migration (§14, « FK différées » — un simple effet
--    d'ordre d'écriture du fichier, PAS une contrainte `DEFERRABLE` ; aucune FK de ce dépôt ne
--    l'est, vérifié par grep sur toutes les migrations existantes), la cible existe déjà ici :
--    l'ALTER TABLE et l'ADD CONSTRAINT se posent donc dans la même section, sans avoir besoin
--    d'attendre une section ultérieure du fichier.
--
-- 3. TROUVÉ EN MESURANT, PAS EN SUPPOSANT — LE VRAI POINT DUR DE CETTE MIGRATION :
--    `imputation_paiement` (0010) est APPEND-ONLY PAR PRIVILÈGE, pas seulement par convention :
--      revoke all    on public.imputation_paiement from dfa_app;
--      grant  select, insert on public.imputation_paiement to dfa_app;
--    contrairement à `paiement`, qui reçoit `UPDATE` en plus de `SELECT, INSERT` (0010 §10) —
--    précisément pour que `exporte_le`/`export_id` restent modifiables sous la garde d'un trigger
--    de liste blanche (`paiement_verrouiller`). `imputation_paiement` n'a NI ce privilège NI ce
--    trigger : il n'en avait jamais eu besoin, une imputation ne se corrigeant que par une
--    imputation de sens opposé (même doctrine que `paiement`, jamais par UPDATE). Vérifié en
--    exécution sur `dfa_dev` avant d'écrire une ligne de cette migration :
--      select has_table_privilege('dfa_app','public.imputation_paiement','UPDATE');  -- => f
--    Sans cette migration, poser seulement les deux colonnes aurait suffi à FAIRE ÉCHOUER le
--    marquage d'export — pas par une règle métier lisible (SQLSTATE ZDFA2 comme `paiement`), mais
--    par un `ERROR: permission denied for table imputation_paiement` brut, au moment même où
--    l'agent de l'export tenterait d'écrire `UPDATE ... SET exporte_le = ...`. C'est le POINT N°1
--    demandé par la tâche, mesuré et non supposé : la réponse est « il faut les DEUX » — le
--    privilège UPDATE (§4) ET un trigger de liste blanche pour que ce privilège fraîchement
--    accordé ne rouvre pas l'immuabilité en grand (§5).
--
-- 4. PRIVILÈGE — `grant select, insert, update`, DELETE toujours absent (revoke all appliqué
--    d'abord, comme 0010 le fait pour `paiement`). `verifierPostureRls()` (`acces-base.service.ts`)
--    ne conditionne AUCUNE déclaration `[dfa:…]` à l'octroi d'UPDATE — seul DELETE l'exige
--    (`MARQUEUR_SUPPRESSION`, ligne 631 du fichier) : cette migration ne pose donc aucun nouveau
--    marqueur de posture, et ne modifie pas non plus le commentaire pour autre chose que la phrase
--    métier ajoutée en §7.
--
-- 5. TRIGGER `imputation_paiement_verrouiller` — RÉPLIQUE DE `paiement_verrouiller` (0010),
--    ADAPTÉE : `imputation_paiement` n'a jamais eu de colonne `modifie_le` (pas de trigger
--    `touche_modifie_le` non plus, une table append-only n'en a jamais eu besoin) — la liste
--    blanche est donc `array['exporte_le', 'export_id']` seulement, sans le troisième élément que
--    `paiement_verrouiller` doit exclure pour lui. Même SQLSTATE `ZDFA2`, même message adapté à
--    l'entité, même `detail` structuré (`entite=imputation_paiement;entite_id=%s`) pour un mapping
--    applicatif futur identique à celui déjà en place pour `paiement`/`document_vente`.
--
-- 6. AUDIT — `imputation_paiement_audit` ne couvrait jusqu'ici que `AFTER INSERT` (cohérent avec
--    une table qui ne pouvait pas recevoir d'UPDATE). Le marquage d'export est désormais un UPDATE
--    réel et doit laisser une trace — recréé en `after insert or update or delete`, MÊME liste
--    d'événements que `paiement_audit`/`document_vente_audit` (0010), y compris `delete` : DELETE
--    reste révoqué à `dfa_app` (§4), ce troisième événement ne peut donc pas se déclencher par le
--    rôle applicatif aujourd'hui — il est présent par défense en profondeur et par cohérence de
--    posture avec les deux triggers jumeaux, pas parce qu'un chemin l'atteint. `auditer_atelier()`
--    (0004) est déjà générique : `imputation_paiement` n'a pas de colonne `statut`, donc toute
--    action tracée sera `modification` (jamais `transition`) — comportement déjà correct pour
--    `paiement`, qui n'a pas non plus de `statut`.
--
-- 7. INDEX — MESURÉ, PAS SUPPOSÉ (banc d'essai réel sur `dfa_dev`, transaction annulée par
--    ROLLBACK, jamais persisté) : 90 672 lignes sur le tenant de démo (5 ans, imputations
--    espacées de 29 minutes — ordre de grandeur visé par la tâche), 1 491 non exportées
--    (dernier mois). Requête cible : « imputations non exportées d'une période », le premier
--    chemin de lecture qu'empruntera le service d'export une fois basculé (voir HORS PÉRIMÈTRE) —
--    même famille que `chargerCandidatsPaiements` dans `service-export-comptable.ts`
--    (`tenant_id = $1 and exporte_le is null and impute_le between $2 and $3`).
--
--      -- AVANT (aucun index dédié ; imputation_paiement_document_idx/_paiement_idx ne portent ni
--      -- impute_le ni exporte_le, et ne discriminent rien ici — un seul document/paiement cible) :
--      explain (analyze, buffers, timing)
--      select id from public.imputation_paiement
--       where tenant_id = '11ed8af1-bcb7-486c-8643-8648380f0221'
--         and exporte_le is null
--         and impute_le between now() - interval '30 days' and now();
--
--      Seq Scan on imputation_paiement (actual time=0.005..6.018 rows=1491 loops=1)
--        Filter: ((exporte_le IS NULL) AND (tenant_id = $1) AND (impute_le >= ...) AND (impute_le <= ...))
--        Rows Removed by Filter: 89181 — Buffers: shared hit=1563
--      Execution Time: 6.072 ms
--
--      -- APRÈS (imputation_paiement_a_exporter_idx, partiel where exporte_le is null) :
--      Index Scan using imputation_paiement_a_exporter_idx (actual time=0.021..0.196 rows=1491 loops=1)
--        Index Cond: ((tenant_id = $1) AND (impute_le >= ...) AND (impute_le <= ...))
--        Buffers: shared hit=28 read=9
--      Execution Time: 0.249 ms
--
--    6.07 ms → 0.25 ms (≈24×), 1563 buffers → 37. PARTIEL (`where exporte_le is null`) plutôt que
--    complet sur `(tenant_id, impute_le)` : l'index n'a besoin de contenir QUE les lignes encore
--    candidates à l'export — une fois marquées, elles en sortent définitivement (l'export ne
--    revient jamais en arrière), donc l'index reste petit et stable dans le temps au lieu de
--    croître sans borne avec l'historique complet du tenant, contrairement à `paiement_date_idx`
--    (0010, complet — sert des lectures qui portent sur TOUT l'historique d'un payeur, pas
--    seulement le non-exporté).
--
--    `CREATE INDEX` ordinaire, pas `CONCURRENTLY` — même limite documentée en détail par 0013 §
--    « ENVISAGÉ, ÉCARTÉ » (`migrer.ts` enveloppe chaque fichier dans une transaction, incompatible
--    avec `CONCURRENTLY`) : acceptable aujourd'hui (étape 1, aucun tenant de production), à revoir
--    avant la première reprise de données réelle ou le premier tenant en production.
--
-- 8. DONNÉES EXISTANTES — MESURÉ, PAS SUPPOSÉ : sur `dfa_dev`, 1 imputation existe au total,
--    0 paiement exporté, donc 0 imputation rattachée à un paiement déjà exporté. Aucune
--    propagation n'est faite ici, et ce n'est pas seulement parce que le compte est nul
--    aujourd'hui : propager `paiement.exporte_le` vers les imputations existantes SUPPOSERAIT que
--    l'export du paiement couvrait déjà TOUTES ses imputations au moment où il a été marqué — une
--    hypothèse invérifiable rétroactivement (c'est exactement l'ambiguïté que cette migration
--    existe pour éliminer), et une écriture de données dans une migration de schéma n'est
--    justifiable que si elle restaure un invariant qu'on peut PROUVER, jamais un état qu'on
--    suppose probable. Sur une base réelle avec des paiements déjà exportés, la bonne réponse est
--    un rapprochement humain (comptable), pas une requête devinée dans une migration.
--
-- HORS PÉRIMÈTRE DE CETTE MIGRATION (`apps/api/src/db/` seulement) :
--   - `apps/api/src/facturation/export/service-export-comptable.ts` doit basculer sa sélection des
--     paiements candidats vers une sélection des IMPUTATIONS non exportées (nouvelle méthode dans
--     l'esprit de `chargerCandidatsPaiements`/`chargerCandidatsDocuments`), et marquer
--     `imputation_paiement.exporte_le`/`export_id` au lieu de (ou en plus de, le temps de la
--     transition) `paiement.exporte_le`/`export_id`.
--   - Devenir de la paire sur `paiement` UNE FOIS CE BASCULEMENT FAIT — mon avis, à valider par
--     @laupernoe : NE PAS la retirer tout de suite même après bascule complète. `paiement.exporte_le`
--     resterait une information de commodité légitime (« ce paiement a-t-il au moins une
--     imputation exportée / est-il intégralement soldé et exporté ? », utile à un écran de suivi
--     sans jointure) SI ET SEULEMENT SI elle cesse d'être la source de vérité pour la décision
--     d'export — ce qui est précisément le bug corrigé ici. Le risque réel n'est pas la colonne
--     elle-même mais qu'un DEUXIÈME chemin de code continue à l'utiliser comme filtre d'export
--     après le basculement (les deux mécanismes divergeraient silencieusement, exactement le
--     symptôme initial). Retrait à envisager seulement après un contract explicite, quand plus
--     aucun service ne la lit comme condition — expand puis contract, pas l'inverse, et ce n'est
--     pas une décision qu'une migration de schéma seule peut trancher.
--   - Un endpoint/service de rapprochement si un futur tenant réel arrive en production avec des
--     paiements déjà exportés sous l'ancien mécanisme (voir §8).
--
-- Réversible : migrations/down/0019_imputation_paiement_export.down.sql.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonnes — nullables, réplique exacte de `paiement`/`document_vente` (§1 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.imputation_paiement
  add column exporte_le timestamptz null,
  add column export_id  uuid null;


-- ---------------------------------------------------------------------------------------------
-- 2. FK composite avec le tenant, RESTRICT (§2 en-tête).
-- ---------------------------------------------------------------------------------------------

alter table public.imputation_paiement
  add constraint imputation_paiement_fk_export foreign key (tenant_id, export_id)
  references public.export_comptable (tenant_id, id) on delete restrict;


-- ---------------------------------------------------------------------------------------------
-- 3. Privilège UPDATE — DELETE reste révoqué (§3/§4 en-tête).
-- ---------------------------------------------------------------------------------------------

revoke all on public.imputation_paiement from dfa_app;
grant  select, insert, update on public.imputation_paiement to dfa_app;


-- ---------------------------------------------------------------------------------------------
-- 4. Trigger d'immuabilité — liste blanche exporte_le/export_id (§5 en-tête).
-- ---------------------------------------------------------------------------------------------

create function public.imputation_paiement_verrouiller() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  colonnes_modifiables text[] := array['exporte_le', 'export_id'];
begin
  if (to_jsonb(new) - colonnes_modifiables) is distinct from (to_jsonb(old) - colonnes_modifiables) then
    raise exception using
      errcode = 'ZDFA2',
      message = 'imputation_paiement : immuable, seuls exporte_le/export_id restent modifiables après création. Corriger par une imputation de sens opposé.',
      detail  = format('entite=imputation_paiement;entite_id=%s', old.id);
  end if;
  return new;
end
$fn$;

revoke all on function public.imputation_paiement_verrouiller() from public;

create trigger imputation_paiement_verrouiller
  before update on public.imputation_paiement
  for each row execute function public.imputation_paiement_verrouiller();


-- ---------------------------------------------------------------------------------------------
-- 5. Audit — étendu à UPDATE (et DELETE par cohérence défensive, §6 en-tête). DROP + CREATE :
--    Postgres n'a pas d'ALTER TRIGGER pour changer la liste d'événements d'un trigger existant.
-- ---------------------------------------------------------------------------------------------

drop trigger imputation_paiement_audit on public.imputation_paiement;

create trigger imputation_paiement_audit
  after insert or update or delete on public.imputation_paiement
  for each row execute function public.auditer_atelier('imputation_paiement');


-- ---------------------------------------------------------------------------------------------
-- 6. Index partiel — mesuré §7 en-tête.
-- ---------------------------------------------------------------------------------------------

create index imputation_paiement_a_exporter_idx on public.imputation_paiement (tenant_id, impute_le)
 where exporte_le is null;


-- ---------------------------------------------------------------------------------------------
-- 7. Commentaire de table complété — texte de 0010 CONSERVÉ EN ENTIER, une phrase ajoutée à la
--    fin. Le DOWN restaure le texte de 0010 mot pour mot (même discipline que 0016/0017/0018).
-- ---------------------------------------------------------------------------------------------

comment on table public.imputation_paiement is
  'Ce que le paiement solde (MD-50). MD-51 : deux invariants agrégés, vérifiés par trigger AFTER '
  'INSERT — (a) Σ imputations d''un document ≤ |total| du document ; (b) Σ imputations de nature '
  '''reglement'' d''un paiement ≤ |montant| du paiement (restriction volontaire, voir CF-05). '
  '`exporte_le`/`export_id` (0019, MD-91) : granularité réelle du suivi d''export comptable — '
  'l''écriture comptable naît à l''IMPUTATION, pas au paiement ; voir imputation_paiement_'
  'verrouiller pour la liste blanche (seules ces deux colonnes restent modifiables après création).';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- 1. Colonnes présentes, nullables, bons types.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'imputation_paiement'
       and column_name = 'exporte_le' and is_nullable = 'YES'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception '0019 : imputation_paiement.exporte_le absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'imputation_paiement'
       and column_name = 'export_id' and is_nullable = 'YES' and data_type = 'uuid'
  ) then
    raise exception '0019 : imputation_paiement.export_id absente, non-nullable, ou de mauvais type.';
  end if;

  -- 2. FK composite avec le tenant présente.
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'imputation_paiement_fk_export'
       and conrelid = 'public.imputation_paiement'::regclass
  ) then
    raise exception '0019 : imputation_paiement_fk_export absente après migration.';
  end if;

  -- 3. Privilèges : SELECT/INSERT/UPDATE, jamais DELETE.
  if not (
    has_table_privilege('dfa_app', 'public.imputation_paiement', 'SELECT')
    and has_table_privilege('dfa_app', 'public.imputation_paiement', 'INSERT')
    and has_table_privilege('dfa_app', 'public.imputation_paiement', 'UPDATE')
  ) then
    raise exception '0019 : dfa_app devrait détenir SELECT/INSERT/UPDATE sur imputation_paiement après migration.';
  end if;

  if has_table_privilege('dfa_app', 'public.imputation_paiement', 'DELETE') then
    raise exception '0019 : dfa_app détient DELETE sur imputation_paiement — devrait rester révoqué (append-only).';
  end if;

  -- 4. Trigger d'immuabilité posé.
  if not exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.imputation_paiement'::regclass
       and tgname = 'imputation_paiement_verrouiller'
  ) then
    raise exception '0019 : trigger imputation_paiement_verrouiller absent après migration.';
  end if;

  -- 5. Trigger d'audit étendu à UPDATE/DELETE. Postgres réordonne toujours les événements en
  --    INSERT OR DELETE OR UPDATE dans pg_get_triggerdef, quel que soit l'ordre d'écriture du
  --    CREATE TRIGGER (vérifié en exécution sur document_vente_audit/paiement_audit, 0010) —
  --    trois recherches indépendantes plutôt qu'une phrase figée, pour ne pas dépendre de cet
  --    ordre de sortie.
  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.imputation_paiement'::regclass
       and t.tgname = 'imputation_paiement_audit'
       and pg_catalog.pg_get_triggerdef(t.oid) ilike '%INSERT%'
       and pg_catalog.pg_get_triggerdef(t.oid) ilike '%UPDATE%'
       and pg_catalog.pg_get_triggerdef(t.oid) ilike '%DELETE%'
  ) then
    raise exception '0019 : imputation_paiement_audit ne couvre pas INSERT/UPDATE/DELETE après migration.';
  end if;

  -- 6. Index partiel posé.
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'imputation_paiement_a_exporter_idx'
  ) then
    raise exception '0019 : imputation_paiement_a_exporter_idx introuvable après création.';
  end if;

  -- 7. Aucune ligne existante altérée : expand pur, tout NULL (garage de démo compris).
  if exists (
    select 1 from public.imputation_paiement where exporte_le is not null or export_id is not null
  ) then
    raise exception '0019 : une ligne de imputation_paiement porte une valeur d''export non-NULL juste après la migration — une valeur a été inventée quelque part.';
  end if;
end
$$;
