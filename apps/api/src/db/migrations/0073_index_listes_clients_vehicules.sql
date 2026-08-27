-- =============================================================================================
-- 0073_index_listes_clients_vehicules.sql — trois index pour le point chaud MESURÉ (banc de
-- charge du 27.08.2026, `scripts/banc/`, base réelle 9916 clients / 6834 véhicules) : `GET
-- /clients` et `GET /vehicules` SANS filtre (première page, tri par défaut) étaient largement plus
-- lents que la RECHERCHE par fragment sur les mêmes tables — contre-intuitif, et le contraire de ce
-- que les notes de travail annonçait depuis le 14.08 (entrée corrigée séparément, hors de cette migration).
--
-- CAUSE, PROUVÉE par EXPLAIN (ANALYZE, BUFFERS), PAS SUPPOSÉE :
--   `service-client.ts::lister()` et `service-vehicule.ts::executerListeVehicules()` composent
--   chacun leur page via plusieurs `LEFT JOIN LATERAL` (localité/nb véhicules/dernier passage pour
--   les clients ; plaque courante/prochaine expertise pour les véhicules), délibérément CHOISI pour
--   éviter le vrai piège (une requête par ligne côté application, commenté en tête de chaque
--   fonction). Ce choix est correct — le défaut mesuré est ANTÉRIEUR à lui : le tri PAR DÉFAUT de
--   chacune des deux listes (`nom:asc` côté clients, `plaque:asc` côté véhicules) ne dispose
--   d'AUCUN index compatible avec l'`ORDER BY`. Sans lui, PostgreSQL ne peut pas pousser le
--   `LIMIT 51` à travers le tri : il matérialise la LATÉRALE pour TOUTES les lignes du tenant
--   (9916 côté clients, 6834 côté véhicules), les trie, puis n'en garde que 51 — un facteur ~130-190x
--   d'évaluations inutiles. `EXPLAIN (ANALYZE, BUFFERS)` sur `dfa_dev` (tenant réel) : clients
--   9916 boucles / 45305 buffers / 115 ms → avec `client_tri_nom_idx`, 51 boucles / 286 buffers /
--   5 ms (voir aussi la restructuration de `service-vehicule.ts` pour le volet véhicules, qui migre
--   la branche « avec plaque courante » vers un index équivalent côté `vehicule_plaque`).
--
-- CE QUE CETTE MIGRATION POSE — trois index, chacun justifié par une requête RÉELLE du dépôt :
--
--   1. `client_tri_nom_idx` — supporte l'`ORDER BY coalesce(raison_sociale, nom || ' ' ||
--      coalesce(prenom, ''))` du tri PAR DÉFAUT `nom:asc`/`nom:desc` (`service-client.ts::lister`,
--      `DEFINITIONS_TRI_CLIENTS`). `id` en seconde colonne : même paire que le `order by ..., c.id`
--      du SELECT et que la condition keyset de reprise de page (`construireConditionKeyset`,
--      `pagination-triee.ts`) — sert aussi bien la première page que toute page suivante. PAS
--      partiel sur `statut` : le filtre `statut` accepté par le contrat (`schemaFiltresClients`)
--      couvre tout `STATUTS_CLIENT`, pas seulement le défaut `actif`+`bloque` — un index partiel
--      figé sur ce défaut resterait inutile dès qu'un site filtre sur un autre sous-ensemble.
--
--   2. `vehicule_plaque_courante_valeur_idx` — supporte l'`ORDER BY pl.valeur` de la branche
--      « véhicules avec plaque courante » introduite par la restructuration de
--      `service-vehicule.ts::executerListeVehiculesTriPlaque` (tri `plaque:asc`/`plaque:desc`,
--      valeur PAR DÉFAUT du contrat, `TRI_DEFAUT_VEHICULES`) : cette branche pilote maintenant la
--      requête depuis `vehicule_plaque` (déjà filtrable/triable par plaque) plutôt que depuis
--      `vehicule` (où la plaque n'existe qu'après une LATÉRALE par ligne). `vehicule_id` en
--      troisième colonne : rejoint `vehicule` sans revenir au tas pour cette seule colonne.
--      Redondant avec `vehicule_plaque_courante_idx` (0016, `(tenant_id, vehicule_id) WHERE au IS
--      NULL`) SEULEMENT en apparence — celui-ci sert l'accès « je connais déjà le véhicule, je veux
--      sa plaque courante » (LATÉRALE des tris `creeLe:desc`/`prochaineExpertiseLe:asc`, encore en
--      place, voir `construireTriEtSeuil`), celui-ci sert l'accès inverse « je parcours les plaques
--      dans l'ordre, je veux le véhicule » — deux directions de jointure, aucun des deux ne peut
--      remplacer l'autre pour l'`ORDER BY` qui lui correspond.
--
--   3. `vehicule_expertise_vehicule_courante_idx` — la LATÉRALE « prochaine expertise » de
--      `service-vehicule.ts` (`select ... from vehicule_expertise where tenant_id = v.tenant_id and
--      vehicule_id = v.id and prochaine_echeance is not null order by prochaine_echeance desc limit
--      1`) n'avait AUCUN index sur `(tenant_id, vehicule_id)` — seul `vehicule_expertise_echeance_idx`
--      (0016, `(tenant_id, prochaine_echeance)`) existe, inutilisable pour un filtre PAR véhicule :
--      `EXPLAIN` montre un `Bitmap Heap Scan` + `Filter: (vehicule_id = v.id)` réévalué à CHAQUE
--      boucle de la LATÉRALE (6834 fois sur `dfa_dev`). `vehicule_expertise` ne compte qu'1 ligne en
--      seed de dev aujourd'hui — l'effet est donc INVISIBLE sur le banc actuel, mais le motif
--      d'accès (une ligne courante par véhicule, filtrée par échéance) est identique à
--      `vehicule_plaque_courante_idx`/`ordre_reparation_client_idx`, déjà couverts ailleurs dans ce
--      dépôt — posé maintenant par cohérence et parce qu'à 200 tenants × 5 ans, cette table cesse
--      d'être quasi vide. Standard de conception de ce dépôt : chaque table reçoit ses index sur
--      les accès courants dès la conception, pas seulement quand la mesure du jour les réclame.
--
-- CE QUI N'EST PAS TOUCHÉ ICI : les tris `creeLe:desc` (déjà servi par `vehicule_pagination_idx`/
-- `client_pagination_idx`, 0016/0016) et `numeroClient:asc/desc` (déjà servi par
-- `client_tenant_numero_uk`, 0006) n'ont montré AUCUN défaut à la mesure — aucun index nouveau pour
-- eux. `prochaineExpertiseLe:asc` reste sur son ancien chemin LATÉRALE-depuis-`vehicule` (pas de
-- restructuration UNION comme pour la plaque) : `vehicule_expertise` est proche de vide en
-- production réelle aujourd'hui, restructurer sans donnée pour le prouver aurait été une
-- optimisation non mesurée — exactement ce que cette tâche demande d'éviter.
--
-- PUREMENT ADDITIF — trois `create index`, rien d'autre : aucune ligne existante affectée,
-- réversible par simple `drop index`.
--
-- Réversible : migrations/down/0073_index_listes_clients_vehicules.down.sql — up → down → up
-- rejoué par la CI.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Clients — tri par défaut `nom:asc`/`nom:desc`.
-- ---------------------------------------------------------------------------------------------

create index client_tri_nom_idx on public.client
  (tenant_id, (coalesce(raison_sociale, nom || ' ' || coalesce(prenom, ''))), id);


-- ---------------------------------------------------------------------------------------------
-- 2. Véhicules — branche « avec plaque courante » du tri par défaut `plaque:asc`/`plaque:desc`.
-- ---------------------------------------------------------------------------------------------

create index vehicule_plaque_courante_valeur_idx on public.vehicule_plaque
  (tenant_id, valeur, vehicule_id) where au is null;


-- ---------------------------------------------------------------------------------------------
-- 3. Véhicules — LATÉRALE « prochaine expertise » (tris `creeLe:desc`/`prochaineExpertiseLe:asc`).
-- ---------------------------------------------------------------------------------------------

create index vehicule_expertise_vehicule_courante_idx on public.vehicule_expertise
  (tenant_id, vehicule_id, prochaine_echeance desc) where prochaine_echeance is not null;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'client_tri_nom_idx'
  ) then
    raise exception '0073 : index client_tri_nom_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_plaque_courante_valeur_idx'
  ) then
    raise exception '0073 : index vehicule_plaque_courante_valeur_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vehicule_expertise_vehicule_courante_idx'
  ) then
    raise exception '0073 : index vehicule_expertise_vehicule_courante_idx introuvable après création.';
  end if;
end
$$;
