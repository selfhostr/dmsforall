-- =============================================================================================
-- 0020_document_vente_numero_recherche.sql — comble une lacune remontée par l'agent qui rend les
-- documents de vente cherchables depuis la recherche globale (`apps/api/src/recherche/`, hors
-- périmètre `db/`) : `GET /recherche?q=2026-00002` renvoie zéro résultat en HTTP réel alors que la
-- facture existe — vérifié par cet agent avant de remonter le besoin.
--
-- MÊME PATRON EXACT QUE 0013 (`ordre_reparation_numero_recherche_idx`, 84.5 ms → 0.9 ms à
-- l'époque) : GIN + `gin_trgm_ops` sur `normaliser_recherche(numero)`, `tenant_id` en tête —
-- même famille que `client_recherche_idx` (0006), `vehicule_vin_recherche_idx`/`vehicule_plaque_
-- recherche_idx` (0007) et `ordre_reparation_numero_recherche_idx` (0013), les quatre autres
-- champs cherchés par fragment au comptoir.
--
-- 1. `normaliser_recherche()` RETENU, PAS LA COLONNE GÉNÉRÉE `numero_normalise` — DEUX
--    MÉCANISMES CONCURRENTS CONSTATÉS, PAS SEULEMENT EN THÉORIE :
--    `document_vente` (0010) porte DÉJÀ une colonne générée `numero_normalise` (majuscules +
--    séparateurs supprimés, `upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g'))`) et son
--    index btree `document_vente_numero_recherche_idx` (`tenant_id, numero_normalise`) — posés en
--    0010 pour « recherche comptoir insensible à la casse et aux séparateurs » (commentaire MD-06
--    d'origine), mais un btree ne peut structurellement pas servir un `LIKE '%fragment%'` (seule
--    l'égalité/le préfixe passent par un btree) : mesuré, `numero_normalise LIKE '%2026-2%'`
--    (réécrit par normalisation manuelle côté requête) tombe en Bitmap Heap Scan malgré l'index,
--    15.5 ms au volume visé — l'index existant N'A JAMAIS PU servir la recherche par fragment
--    qu'il visait. Le reste du moteur (`service-recherche.ts` : véhicule/VIN/plaque, client,
--    ordre_reparation) normalise TOUJOURS via `normaliser_recherche()` (minuscules + sans accent
--    + séparateurs supprimés, 0003) — DEUX fonctions de normalisation qui divergent réellement :
--    taper `2026-2` normalise différemment selon laquelle des deux traite la saisie. Retenir
--    `numero_normalise` pour ce nouvel index aurait ajouté une TROISIÈME incohérence (deux
--    normalisations déjà en place, ce nouvel index en introduisant l'usage d'une troisième
--    combinaison) au lieu d'en résoudre une. `normaliser_recherche()` est retenu ici pour LA
--    COHÉRENCE DU MOTEUR : un même fragment tapé au comptoir doit produire le même filtre, qu'on
--    cherche un véhicule, un client, un OR ou un document de vente.
--
--    `numero_normalise` (colonne générée) ET `document_vente_numero_recherche_idx` (son btree) NE
--    SONT PAS RETIRÉS PAR CETTE MIGRATION — mesuré, pas supposé : ni l'un ni l'autre n'est lu par
--    aucun chemin de code applicatif aujourd'hui (`grep -rn 'numeroNormalise'` sur `apps/api/src`
--    et `apps/web/src` : zéro occurrence hors migrations/commentaires de schéma ; le seul autre
--    endroit qui MENTIONNE `numero_normalise` en SQL est le trigger `document_vente_verrouiller_
--    apres_emission`, qui doit l'exclure de sa comparaison BEFORE UPDATE parce que Postgres ne
--    recalcule une colonne GENERATED ALWAYS ... STORED qu'APRÈS que tous les triggers BEFORE ROW
--    aient fini — cette exclusion resterait nécessaire tant que la colonne existe, quel que soit
--    son usage par ailleurs). Poids mort à signaler à l'orchestrateur, PAS à supprimer ici :
--    supprimer une colonne générée et son index est un CONTRACT (retire une capacité), alors que
--    cette migration est un EXPAND (ajoute un index) — les deux ne se mélangent pas dans le même
--    fichier par doctrine de ce dépôt, et un CONTRACT n'est légitime qu'une fois établi qu'aucun
--    consommateur, présent OU PRÉVU À COURT TERME, n'en dépend. Avis transmis à l'orchestrateur
--    par ailleurs (pas dans cette migration) : je n'ai trouvé aucun tel consommateur — mais c'est
--    à l'orchestrateur de confirmer qu'aucun plan en cours (écran, export) ne compte dessus avant
--    qu'un futur `00NN_document_vente_numero_normalise_retrait.sql` ne les retire.
--
-- 2. `coalesce()` ENVISAGÉ, ÉCARTÉ — DIFFÉRENCE VOLONTAIRE AVEC `vehicule_vin_recherche_idx`
--    (0007, `coalesce(vin, '')`) : `vehicule.vin` est nullable ET recherché même absent (un
--    véhicule sans VIN doit rester trouvable par plaque/marque via le même index composite).
--    `document_vente.numero` est nullable UNIQUEMENT pour un document en `brouillon`
--    (`document_vente_numero_brouillon_chk`, 0010 : `(statut = 'brouillon') = (numero is null)`)
--    — et un brouillon n'a, par construction, aucun numéro qu'un client pourrait lire au
--    téléphone : il n'y a rien à chercher par CE critère avant l'émission. `normaliser_recherche()`
--    est `STRICT` (0003) : `normaliser_recherche(null)` rend `null`, silencieusement absent de
--    l'index GIN (un GIN n'indexe pas les clés NULL) — comportement déjà correct sans `coalesce`,
--    exactement le choix fait par 0013 pour `ordre_reparation.numero` (`not null` là, nullable
--    ici, mais l'effet recherché — ignorer les lignes sans numéro affiché — est le même dans les
--    deux cas). Un `coalesce(numero, '')` forcerait au contraire CHAQUE brouillon dans l'index
--    pour une chaîne vide sans valeur de recherche, sans bénéfice.
--
-- PREUVE — banc d'essai RÉEL sur `dfa_dev`, 91 250 lignes de facture insérées dans une transaction
-- ANNULÉE par ROLLBACK (jamais persisté), reprenant un document `facture`/`emis` existant avec
-- `numero`/`numero_sequence` rendus uniques (`2026-001001` .. `2026-092250`) — même ordre de
-- grandeur que 0013 (5 ans × 50 OR/jour) :
--
--   -- AVANT (aucun index dédié) : recherche du fragment lu au téléphone.
--   explain (analyze, buffers, timing)
--   select id, numero from public.document_vente
--    where tenant_id = '<tenant>'
--      and public.normaliser_recherche(numero) like public.normaliser_recherche('%2026-00002%');
--
--   Gather (actual time=0.212..78.716 rows=1 loops=1)
--     ->  Parallel Seq Scan on document_vente (actual time=48.167..73.178 rows=0 loops=3)
--           Filter: (tenant_id = $1 AND normaliser_recherche(numero) ~~ '%202600002%')
--           Rows Removed by Filter: 30419 — Buffers: shared hit=4505
--   Execution Time: 78.727 ms
--
--   -- APRÈS (document_vente_numero_recherche_trgm_idx) : même requête, fragment.
--   Bitmap Heap Scan on document_vente (actual time=1.864..1.874 rows=1 loops=1)
--     ->  Bitmap Index Scan on document_vente_numero_recherche_trgm_idx (actual time=1.798..1.798 rows=3 loops=1)
--     Buffers: shared hit=126
--   Execution Time: 1.908 ms
--
--   -- APRÈS, numéro complet (le cas « client au téléphone » exact) :
--   Bitmap Heap Scan on document_vente (actual time=2.404..2.408 rows=1 loops=1)
--     Buffers: shared hit=183
--   Execution Time: 2.434 ms
--
-- 78.7 ms → 1.9 ms fragment (≈41×), 4505 buffers → 126 ; 2.4 ms sur le numéro exact. Balayage
-- séquentiel complet du tenant à CHAQUE frappe côté comptoir avant cette migration, comme 0013
-- l'avait déjà mesuré pour `ordre_reparation`.
--
-- `CREATE INDEX CONCURRENTLY` ENVISAGÉ, ÉCARTÉ — MÊME MOTIF QUE 0013 (`migrer.ts` enveloppe
-- chaque fichier dans une transaction ; `CONCURRENTLY` le refuse structurellement). Acceptable
-- aujourd'hui (étape 1, aucun tenant de production réel — cf. CONTRIBUTING.md feuille de route) : le
-- verrou `ACCESS EXCLUSIVE` dure quelques millisecondes sur les volumes réels du dépôt. Ce calcul
-- ne tiendra plus dès la première reprise de données ou le premier tenant en production — même
-- suite recommandée que 0013 (marqueur déclaratif de migration non-transactionnelle dans
-- `migrer.ts`, hors périmètre `db/migrations/`).
--
-- Réversible : migrations/down/0020_document_vente_numero_recherche.down.sql — supprime
-- uniquement l'index créé ici, rien d'autre.
-- =============================================================================================

create index document_vente_numero_recherche_trgm_idx on public.document_vente
  using gin (tenant_id, public.normaliser_recherche(numero) gin_trgm_ops);


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'document_vente_numero_recherche_trgm_idx'
  ) then
    raise exception '0020 : document_vente_numero_recherche_trgm_idx introuvable après création.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_index i
      join pg_catalog.pg_class ic on ic.oid = i.indexrelid
      join pg_catalog.pg_am am on am.oid = ic.relam
     where ic.relname = 'document_vente_numero_recherche_trgm_idx'
       and am.amname = 'gin'
  ) then
    raise exception '0020 : document_vente_numero_recherche_trgm_idx n''est pas un index GIN.';
  end if;
end
$$;
