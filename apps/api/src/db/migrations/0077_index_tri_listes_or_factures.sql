-- =============================================================================================
-- 0077_index_tri_listes_or_factures.sql — deux index composites pour le TRI PAR DÉFAUT de
-- `GET /ordres-reparation` et `GET /documents-vente`, désormais paginés en keyset
-- (`common/pagination`, `construireConditionKeyset`) au lieu d'un offset déguisé en curseur.
--
-- CAUSE : aucun index existant ne commence par `(tenant_id, <colonne de tri>)`.
--   - `ordre_reparation` (0008) : `ordre_reparation_vehicule_idx` / `_client_idx` sont préfixés par
--     `vehicule_id` / `client_id`, `_pagination_idx` trie sur `cree_le`, pas sur `ouvert_le`.
--   - `document_vente` (0010 §848, 0049) : `document_vente_client_idx` est préfixé par `client_id`,
--     `document_vente_financier_periode_idx` par `type_document` et partiel (`statut <> 'brouillon'`).
-- Sans index ordonné, PostgreSQL lit tout le tenant, trie, puis jette tout sauf 51 lignes.
--
-- CE QUE LES DEUX INDEX SERVENT (l'`ORDER BY` du service, mot pour mot) :
--   1. `ordre_reparation_tri_ouvert_le_idx` : `ORDER BY ouvert_le DESC NULLS LAST, id DESC`
--      (tri `ouvertLe:desc`, valeur par défaut du contrat ; `NULLS LAST` car un OR `planifie` n'a
--      pas encore de date d'ouverture — doctrine du service). La comparaison ROW du keyset
--      `(ouvert_le, id) < (v, id)` utilise le même ordre : arrêt anticipé au `LIMIT`.
--   2. `document_vente_tri_date_idx` : `ORDER BY date_document DESC NULLS LAST, cree_le DESC,
--      id DESC` (tri `dateDocument:desc`, défaut). `cree_le` départage les nombreux documents d'un
--      même jour ET garde « le plus récent d'abord » à l'intérieur d'une journée.
-- Les autres tris du contrat (`ouvertLe:asc`, `restitutionPromiseLe`, `joursAttenteRetrait`,
-- `numeroSequence`, `soldeCentimes`, `relanceLe`) restent non indexés : usage marginal, pas mesuré
-- comme point chaud — pas d'index spéculatif. Aucun doublon : vérifié contre toutes les migrations
-- (`grep "on public.ordre_reparation\|on public.document_vente"`).
--
-- MESURE — EXPLAIN (ANALYZE, BUFFERS) sur une base éphémère, rôle `dfa_app` (RLS actif), tenant de
-- 40 000 OR (8 % sans `ouvert_le`) et 40 000 documents + 5 000 lignes d'un autre tenant, `analyze`
-- fait. Requêtes = celles que le service émet ; « ancien » = `ORDER BY … LIMIT 51 OFFSET 20000`.
--
--                                          sans index 0077              avec index 0077
--   OR       page 1 (keyset)               149.8 ms  Seq Scan + top-N   0.40 ms  Index Scan, 51 lignes lues
--   OR       page profonde (20 000)        ancien 218.8 ms (tri disque) 8.9 ms   (sans index : 90.5 ms)
--   Factures page 1 (keyset)               371.1 ms  Seq Scan + top-N   0.79 ms  Index Scan, 51 lignes lues
--   Factures page profonde (20 000)        ancien 576.9 ms (tri disque) 24.8 ms  (sans index : 209.0 ms)
--
-- Les pages 1 (cas courant) lisent exactement 51 lignes d'index. Les pages profondes restent
-- LINÉAIRES en la profondeur (la condition keyset sur colonne nullable s'écrit `ROW(...) < (...) OR
-- col IS NULL`, appliquée en `Filter` — 20 001 lignes écartées ci-dessus) mais ne trient plus rien :
-- ~10x moins cher qu'avant, même limite que clients/véhicules (0073). Un OR `planifie` sans date
-- d'ouverture est la raison de `nullable`.
--
-- PUREMENT ADDITIF — deux `create index`, réversible par `drop index`.
-- Réversible : migrations/down/0077_index_tri_listes_or_factures.down.sql (up -> down -> up en CI).
-- =============================================================================================

create index ordre_reparation_tri_ouvert_le_idx on public.ordre_reparation
  (tenant_id, ouvert_le desc nulls last, id desc);

create index document_vente_tri_date_idx on public.document_vente
  (tenant_id, date_document desc nulls last, cree_le desc, id desc);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ordre_reparation_tri_ouvert_le_idx'
  ) then
    raise exception '0077 : index ordre_reparation_tri_ouvert_le_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_vente_tri_date_idx'
  ) then
    raise exception '0077 : index document_vente_tri_date_idx introuvable après création.';
  end if;
end
$$;
