-- #63 : la recherche « Prénom Nom » (« Urs Meier ») ne passait par aucun index. `client_recherche_idx`
-- (0006) couvre l'ordre « Nom Prénom » ; l'ordre inverse était construit avec `concat_ws`, qui est
-- STABLE (donc inindexable). On pose un second index GIN trigram sur l'expression « prénom nom »
-- IMMUTABLE `coalesce(raison_sociale, coalesce(prenom || ' ', '') || nom, '')`, que les requêtes
-- (recherche globale, liste clients, dossiers de vente) reprennent à l'identique. Équivalent à
-- concat_ws(' ', prenom, nom) tant que `nom` est non nul (CHECK d'identité 0006 pour les particuliers).
-- Préfixe tenant_id : voir 0006 (sans lui le trigramme scannerait tous les tenants avant le RLS).
-- CREATE INDEX transactionnel (pas CONCURRENTLY) : les migrations tournent en transaction.
create index client_recherche_prenom_nom_idx on public.client
  using gin (
    tenant_id,
    public.normaliser_recherche(
      coalesce(raison_sociale, coalesce(prenom || ' ', '') || nom, '')
    ) gin_trgm_ops
  );
