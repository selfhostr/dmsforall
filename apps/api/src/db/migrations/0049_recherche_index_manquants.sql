-- =============================================================================================
-- 0049_recherche_index_manquants.sql — pose les index laissés en dette technique documentée par
-- deux agents antérieurs, hors de leur périmètre d'écriture respectif :
--
--   1-3. `apps/api/src/recherche/service-recherche.ts` (tête de fichier + `chercherArticles`,
--        `chercherFournisseurs`, `chercherDepotsPneus`) : la recherche comptoir a été étendue aux
--        natures `article`, `fournisseur`, `depot_pneu`, sur le même mécanisme que les natures
--        existantes (`public.normaliser_recherche()` + GIN trigram, famille 0006/0007/0013), mais
--        SANS pouvoir poser les index — `apps/api/src/db/` n'est pas le périmètre de cet agent.
--        Chaque index ci-dessous est repris de l'expression EXACTE proposée en commentaire dans ce
--        fichier, vérifiée ici contre la requête réelle avant d'être posée (colonnes confirmées
--        dans 0022_pieces_referentiel.sql pour `article`/`fournisseur`, 0043_pneus_depot_pneus.sql
--        pour `depot_pneus`).
--   4.   `apps/api/src/tableau-bord/service-tableau-bord-financier.ts` (`ServiceTableauBordFinancier
--        .obtenir`, lignes 58-83) : QUATRE sous-requêtes scalaires (`totalHtCentimes`,
--        `totalTvaCentimes`, `totalTtcCentimes`, `nombreDocuments`) réutilisent LE MÊME fragment
--        `filtreDocumentsPeriode` — un seul `and` répété quatre fois sur `document_vente`, sans
--        aucun index qui le serve. Signalé par audit, comblé ici par un index ; voir le point 4
--        ci-dessous pour ce qu'un index seul NE règle PAS.
--
-- Sans ces cinq index, les cinq requêtes concernées font un balayage complet du tenant à chaque
-- appel — même symptôme, même remède que 0013 (`ordre_reparation_numero_recherche_idx`) : à ce
-- stade du dépôt, aucune mesure EXPLAIN neuve n'a pu être prise (interdiction explicite de migrer
-- la base de dev pendant cette tâche, `pnpm db:migrate` réservé aux vérifications en cours) — la
-- justification tient donc à la correspondance EXACTE entre l'expression indexée et l'expression
-- de la requête, pas à un chiffre mesuré ici.
--
-- =============================================================================================
-- 1. ARTICLE — désignation et référence principale (chercherArticles)
-- =============================================================================================
--
-- Requête (service-recherche.ts, chercherArticles) :
--   where a.tenant_id = $1 and a.statut <> 'desactive'
--     and ( public.normaliser_recherche(a.designation)          like public.normaliser_recherche($2)
--        or public.normaliser_recherche(a.reference_principale) like public.normaliser_recherche($2) )
--
-- Deux branches, deux expressions distinctes -> DEUX index (même patron que
-- `vehicule_vin_recherche_idx` / `vehicule_plaque_recherche_idx`, 0007 : un index GIN
-- multi-colonnes ne fusionne pas deux expressions indépendantes dans un même OR). `designation` et
-- `reference_principale` sont toutes deux `not null` (0022) : pas de `coalesce` requis, à la
-- différence de `vehicule.vin`.
create index article_designation_recherche_idx on public.article
  using gin (tenant_id, public.normaliser_recherche(designation) gin_trgm_ops);

create index article_reference_principale_recherche_idx on public.article
  using gin (tenant_id, public.normaliser_recherche(reference_principale) gin_trgm_ops);

-- =============================================================================================
-- 2. FOURNISSEUR — nom (chercherFournisseurs)
-- =============================================================================================
--
-- Requête (service-recherche.ts, chercherFournisseurs) :
--   where f.tenant_id = $1 and f.statut <> 'inactif'
--     and public.normaliser_recherche(f.nom) like public.normaliser_recherche($2)
--
-- `nom` est `not null` (0022) : pas de `coalesce`.
create index fournisseur_nom_recherche_idx on public.fournisseur
  using gin (tenant_id, public.normaliser_recherche(nom) gin_trgm_ops);

-- =============================================================================================
-- 3. DEPOT_PNEUS — repère de rangement (chercherDepotsPneus)
-- =============================================================================================
--
-- Requête (service-recherche.ts, chercherDepotsPneus) — troisième branche du OR :
--   or (d.code_case is not null
--       and public.normaliser_recherche(d.code_case) like public.normaliser_recherche($2))
--
-- Expression indexée SANS `coalesce` : c'est la forme exacte utilisée par la requête
-- (`d.code_case is not null` est un garde-fou explicite AVANT l'appel, pas un `coalesce` dans
-- l'expression — contrairement à `vehicule.vin`). `code_case` est nullable (RPP-07, texte libre,
-- 0043) : les lignes à `code_case is null` sont simplement absentes de l'index GIN (normal, sans
-- conséquence — `normaliser_recherche` est STRICT et ne les aurait de toute façon jamais matchées).
--
-- La plaque et le nom du détenteur (les deux autres branches du même OR) ne sont PAS indexés ici :
-- elles traversent `vehicule_plaque`/`client` par jointure LATERAL et profitent déjà de
-- `vehicule_plaque_recherche_idx` (0007) et `client_recherche_idx` (0006) — les redoubler sur
-- `depot_pneus` n'aurait aucun sens, la colonne recherchée n'existe même pas sur cette table.
create index depot_pneus_code_case_recherche_idx on public.depot_pneus
  using gin (tenant_id, public.normaliser_recherche(code_case) gin_trgm_ops);

-- =============================================================================================
-- 4. DOCUMENT_VENTE — filtre de période du tableau de bord financier
-- =============================================================================================
--
-- Fragment réutilisé quatre fois sans changement (service-tableau-bord-financier.ts:58-63) :
--   d.tenant_id = $1 [and d.site_id = $2]
--   and d.type_document in ('facture', 'avoir')
--   and d.statut <> 'brouillon'
--   and d.date_document >= $3 and d.date_document <= $4
--
-- VERDICT — un index sert ce filtre, mais ne règle qu'une partie du problème signalé par
-- l'audit :
--   - la REDONDANCE des quatre sous-requêtes (une table balayée quatre fois pour trois sommes et
--     un compte qui partagent exactement le même filtre) n'est PAS résolue par un index : elle se
--     résout en fusionnant les quatre `select ... where filtreDocumentsPeriode` en un seul passage
--     (`sum(...) filter (where ...)` / agrégats conditionnels dans une unique requête). Ce
--     changement touche `apps/api/src/tableau-bord/service-tableau-bord-financier.ts`, hors
--     périmètre de cette migration (`apps/api/src/db/migrations/` uniquement) — signalé pour
--     suite, pas traité ici.
--   - CE QU'UN INDEX RÈGLE : chacune des quatre sous-requêtes, prise isolément, balaie aujourd'hui
--     l'intégralité du tenant sur `document_vente` (aucun index n'exploite `type_document` +
--     `date_document` ensemble — seuls existent `document_vente_client_idx`,
--     `document_vente_or_idx`, `document_vente_ouvert_idx`, `document_vente_pagination_idx`,
--     aucun sur ce filtre). Même sans fusion des quatre requêtes, cet index transforme chacune
--     d'elles en Bitmap/Index Scan borné par tenant + type + période au lieu d'un Seq Scan complet
--     — donc posé, comme correction PARTIELLE mais réelle, en attendant la fusion applicative.
--
-- FORME : `(tenant_id, type_document, date_document)` — équijointures (`tenant_id`,
-- `type_document` via IN à deux valeurs) avant la colonne de plage (`date_document`), même
-- discipline que tout index btree existant sur cette table. Index PARTIEL
-- `where statut <> 'brouillon'` : correspond mot pour mot au filtre de la requête (un brouillon
-- n'a pas encore de numero — 0010 `document_vente_numero_brouillon_chk` — et n'a donc pas sa place
-- dans un chiffre d'affaires émis), réduit d'autant la taille de l'index, et reste exploitable par
-- Postgres car l'expression du prédicat matche syntaxiquement celle de la clause `where`.
--
-- `site_id` (filtre optionnel, présent seulement si l'appelant précise un site) est
-- DÉLIBÉRÉMENT absent des colonnes indexées : une colonne d'égalité placée après une colonne de
-- plage (`date_document`) ne resserre pas le balayage de l'index — seul un préfixe strict
-- d'égalités le permet — et le rendre obligatoire en tête pénaliserait au contraire les appels
-- sans filtre de site (le cas `direction` consultant tous les sites, RF-115). Le filtre de site,
-- quand présent, s'applique en `Filter` résiduel après un scan déjà borné par tenant + type +
-- période — borne largement suffisante au volume visé (5 ans x 50 documents/jour par tenant,
-- réduit encore par la période demandée, typiquement un mois ou un exercice).
create index document_vente_financier_periode_idx on public.document_vente
  (tenant_id, type_document, date_document)
  where statut <> 'brouillon';

-- `pg_trgm` : DÉJÀ créée par 0003_prealables_etape1.sql (`create extension if not exists pg_trgm`),
-- rien à refaire ici — vérifié avant d'écrire cette migration plutôt que supposé.

-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'article_designation_recherche_idx'
  ) then
    raise exception '0049 : article_designation_recherche_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'article_reference_principale_recherche_idx'
  ) then
    raise exception '0049 : article_reference_principale_recherche_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'fournisseur_nom_recherche_idx'
  ) then
    raise exception '0049 : fournisseur_nom_recherche_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'depot_pneus_code_case_recherche_idx'
  ) then
    raise exception '0049 : depot_pneus_code_case_recherche_idx introuvable après création.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_vente_financier_periode_idx'
  ) then
    raise exception '0049 : document_vente_financier_periode_idx introuvable après création.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_index i on i.indexrelid = c.oid
      join pg_catalog.pg_am am on am.oid = c.relam
     where n.nspname = 'public'
       and c.relname in (
         'article_designation_recherche_idx',
         'article_reference_principale_recherche_idx',
         'fournisseur_nom_recherche_idx',
         'depot_pneus_code_case_recherche_idx'
       )
       and am.amname <> 'gin'
  ) then
    raise exception '0049 : un des quatre index trigram attendus n''est pas de type GIN.';
  end if;
end
$$;
