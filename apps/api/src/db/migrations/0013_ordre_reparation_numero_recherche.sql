-- =============================================================================================
-- 0013_ordre_reparation_numero_recherche.sql — comble une lacune signalée en commentaire dans le
-- code applicatif (dette technique documentée, pas découverte ici).
--
-- CONSTAT : `apps/api/src/recherche/service-recherche.ts` (`chercherOrdres`) filtre
--   `o.tenant_id = $1 and public.normaliser_recherche(o.numero) like public.normaliser_recherche($2)`
-- pour la recherche comptoir par numéro d'OR — appelée à CHAQUE véhicule qui se présente au
-- comptoir (le chemin le plus chaud du produit, déjà protégé par une limitation de débit, signe
-- qu'on sait le chemin fragile). `ordre_reparation.numero` n'a jamais eu d'index d'expression
-- trigram, contrairement à `vehicule_plaque.valeur` et `vehicule.vin` (0007) et au nom/raison
-- sociale de `client` (0006) — les trois autres champs cherchés par fragment au comptoir. Le
-- code le documentait déjà lui-même avec le motif exact à créer ; cette migration l'applique tel
-- quel, après vérification (voir PREUVE ci-dessous : le motif proposé matchait déjà
-- syntaxiquement l'expression de la requête, `numero` étant `not null` — aucun `coalesce` requis,
-- à la différence de `vehicule.vin`, nullable).
--
-- PREUVE (avant migration, banc d'essai à 91 250 lignes sur un seul tenant — 5 ans × 50 OR/jour,
-- le volume visé par la tâche) :
--
--   explain (analyze, buffers)
--   select o.id, o.numero from public.ordre_reparation o
--    where o.tenant_id = '<tenant>'
--      and public.normaliser_recherche(o.numero) like public.normaliser_recherche('%45000%')
--    order by ... limit 20;
--
--   ->  Parallel Seq Scan on ordre_reparation o (actual time=66.008..78.984 rows=0 loops=3)
--         Filter: (tenant_id = $1 AND normaliser_recherche(numero) ~~ '%45000%')
--         Rows Removed by Filter: 30418
--       Buffers: shared hit=3595 read=695 — Execution Time: 84.559 ms
--
-- Balayage complet des 91 250 lignes du tenant (réparti sur les 2 workers parallèles), à CHAQUE
-- frappe. Après cette migration, le même `EXPLAIN` bascule sur un Bitmap Index Scan sur
-- `ordre_reparation_numero_recherche_idx` (~200 buffers, <2 ms) — capture complète dans le
-- rapport de livraison, pas reproduite ici (une migration SQL n'est pas le bon endroit pour un
-- journal de bench).
--
-- FORME DE L'INDEX : GIN + `gin_trgm_ops`, `tenant_id` en tête — même famille exacte que
-- `client_recherche_idx` (0006), `vehicule_vin_recherche_idx` et `vehicule_plaque_recherche_idx`
-- (0007). `tenant_id` en tête n'est pas qu'une convention : un GIN multi-colonnes AND les deux
-- conditions au niveau de l'index lui-même (bitmap), donc la restriction tenant n'est jamais
-- perdue même si `numero` a une faible sélectivité entre tenants (deux garages peuvent avoir des
-- préfixes de numérotation identiques, RM-112 n'impose aucun format global).
--
-- AUTRES LACUNES DU MÊME GENRE CHERCHÉES, NON COMBLÉES ICI (hors périmètre d'une migration
-- seule, signalées pour suite plutôt que devinées) :
--   - `apps/api/src/vehicules/service-vehicule.ts` (`executerListeVehicules`, filtre `q`) cherche
--     `marque`/`modèle` en fragment via `coalesce(v.marque,'') || ' ' || coalesce(v.modele,'')`,
--     mais l'index existant `vehicule_marque_modele_idx` (0007) est un btree SANS `gin_trgm_ops`
--     sur une expression SANS `coalesce` — un btree ne peut de toute façon jamais servir un
--     `LIKE '%fragment%'`, et l'expression ne correspond même pas à celle de la requête. Cet
--     index n'a jamais pu être utilisé par la requête qui l'a motivé. Vérifié par `EXPLAIN` que
--     la branche `marque`/`modèle` est de toute façon combinée dans un `OR` avec un `EXISTS`
--     corrélé sur `vehicule_plaque` — PostgreSQL ne construit pas de `BitmapOr` à travers un
--     `EXISTS`, donc même un index GIN trigram correctement formé sur `marque`/`modèle` NE
--     SERAIT PAS employé par cette requête telle qu'écrite aujourd'hui. Le correctif réel est une
--     restructuration de la requête (UNION/LATERAL, même idiome que `service-recherche.ts`), pas
--     un index — hors périmètre `db/migrations/`.
--   - `apps/api/src/clients/service-client.ts` (`lister`, filtre `q`) construit un `OR` à cinq
--     branches (`raison_sociale`/nom en similarité trigram, `numero`/`email`/`ide` en `ilike`
--     fragment sans index, `telephone_e164` en `like` fragment sans index). Même symptôme :
--     PostgreSQL ne peut pas combiner un `OR` en `BitmapOr` dès qu'UNE branche n'a aucun chemin
--     d'index — la présence de `client_recherche_idx` (0006) ne change donc rien au plan de
--     CETTE requête précise, alors même qu'il sert correctement `service-recherche.ts` (dont
--     l'expression ET la structure de requête sont différentes — une seule condition, jamais un
--     `OR` multi-colonnes). Là aussi, le correctif est une restructuration de requête, pas un
--     index db/migrations/ isolé.
--   Les deux points ci-dessus sont remontés à l'orchestrateur plutôt que traités ici : les
--   ajouter en `db/migrations/` seul, sans le changement de requête qui les rendrait réellement
--   utilisés, aurait payé le coût d'écriture de l'index sans jamais toucher le bénéfice de
--   lecture — exactement l'erreur que la tâche demandait d'éviter.
--
-- `CREATE INDEX CONCURRENTLY` ENVISAGÉ, ÉCARTÉ POUR CETTE MIGRATION — ET POURQUOI :
--   `apps/api/src/db/migrer.ts` exécute CHAQUE fichier de migration dans une seule transaction
--   (`begin` … `client.query(contenu)` … `commit`, avec `rollback` si le fichier échoue) : c'est
--   ce qui garantit qu'une migration ratée ne laisse jamais un schéma à moitié appliqué. Or
--   `CREATE INDEX CONCURRENTLY` REFUSE structurellement de s'exécuter à l'intérieur d'un bloc de
--   transaction (erreur PostgreSQL : « CREATE INDEX CONCURRENTLY cannot run inside a transaction
--   block ») — les deux garanties sont mutuellement exclusives dans ce runner tel qu'il existe
--   aujourd'hui. L'écrire quand même aurait simplement fait échouer la migration à l'exécution.
--   CONSÉQUENCE ACCEPTÉE ICI : un `CREATE INDEX` ordinaire prend un verrou `ACCESS EXCLUSIVE`
--   pendant la construction de l'index — toute lecture ET écriture sur `ordre_reparation` est
--   bloquée pour la durée de la construction (proportionnelle au volume déjà en base). Au stade
--   actuel du dépôt (étape 1, données de démo/dev, aucun premier garage en production — la
--   production réelle est étape 2, cf. CONTRIBUTING.md §feuille de route), le volume par tenant est nul
--   à négligeable : le verrou dure quelques millisecondes, sans impact perceptible. CE CALCUL NE
--   TIENDRA PLUS le jour où une reprise de données réelle (expert-migration-donnees) aura chargé
--   des milliers d'OR d'un coup AVANT que cette migration ne soit rejouée sur cette base, ou plus
--   généralement dès qu'un tenant réel tourne en production pendant qu'une migration future doit
--   ajouter un index sur une table à fort trafic d'écriture : bloquer l'ouverture d'OR le temps
--   de construire un index sur des dizaines de milliers de lignes serait alors inacceptable.
--   SUITE RECOMMANDÉE, PAS FAITE ICI (hors périmètre `db/migrations/`, et une décision d'outillage
--   que je ne tranche pas seul) : donner à `migrer.ts` un moyen déclaratif de marquer un fichier
--   de migration comme « non-transactionnel » (par exemple un en-tête `-- dfa:hors-transaction`
--   détecté avant `begin`), pour que `CREATE INDEX CONCURRENTLY` devienne possible avant la
--   première reprise de données ou le premier tenant en production sur une table déjà volumineuse.
--
-- Réversible : migrations/down/0013_ordre_reparation_numero_recherche.down.sql — supprime
-- uniquement l'index créé ici, rien d'autre. Testé up → down → up sur base réelle (rapport de
-- livraison).
-- =============================================================================================

create index ordre_reparation_numero_recherche_idx on public.ordre_reparation
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
       and c.relname = 'ordre_reparation_numero_recherche_idx'
  ) then
    raise exception '0013 : ordre_reparation_numero_recherche_idx introuvable après création.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_index i
      join pg_catalog.pg_class ic on ic.oid = i.indexrelid
      join pg_catalog.pg_am am on am.oid = ic.relam
     where ic.relname = 'ordre_reparation_numero_recherche_idx'
       and am.amname = 'gin'
  ) then
    raise exception '0013 : ordre_reparation_numero_recherche_idx n''est pas un index GIN.';
  end if;
end
$$;
