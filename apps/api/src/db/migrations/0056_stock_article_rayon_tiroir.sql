-- =============================================================================================
-- 0056_stock_article_rayon_tiroir.sql — casier structuré (rayon, tiroir) EN COMPLÉMENT du texte
-- libre existant (`stock_article.emplacement`, 0025), jamais à sa place. Décision de @laupernoe,
-- tranchée le 14.08.2026 : deux magasiniers écrivent la même case de deux façons différentes
-- (« B3 », « b3 », « B 3 ») et personne ne s'y retrouve — le texte libre continue de servir les
-- cas particuliers (« étagère du fond », « dehors sous bâche ») et les articles hors casier ; rien
-- n'est migré de force, l'inventaire se fiabilise article par article.
--
-- ÉCARTÉ EXPLICITEMENT (même décision) : remplacer le texte libre par la structure (reprise de
-- chaque article existant, et les cas hors casier n'auraient plus où aller) ; un troisième niveau
-- « allée » (inutile pour un magasin qui tient dans une pièce).
--
-- RATTACHEMENT — même patron EXACT que `emplacement` (0025) : par (tenant, article, site), sur
-- `stock_article`, PAS sur `article` — un même article peut être rangé ailleurs dans un autre
-- garage, exactement comme le texte libre actuel. Voir `service-stock.ts::modifierSite`
-- (`PATCH /articles/{id}/stock/{siteId}`) : rayon/tiroir rejoignent emplacement/seuils comme
-- réglages de site, jamais embarqués sur le référentiel article lui-même.
--
-- TYPES — deux colonnes `text` courtes, PAS un enum ni une table de référence séparée : le jeu de
-- rayons/tiroirs varie librement par garage (et par site d'un même garage) sans vocabulaire fermé
-- à faire évoluer en migration à chaque nouvelle étagère — même logique que `emplacement` déjà en
-- place, juste structuré en deux champs courts plutôt qu'une seule phrase libre.
--
-- NORMALISATION — LE point du chantier, posée EN BASE, pas seulement à l'écriture applicative :
-- `B3`, `b3` et `B 3` DOIVENT être le même rayon, sinon la structuration ne fait que déplacer le
-- problème du texte libre (deux magasiniers, deux graphies, plus personne qui s'y retrouve).
-- Choix : la colonne stockée EST TOUJOURS sa propre forme canonique (majuscules, aucun espace
-- interne) — imposé par un CHECK qui compare `rayon`/`tiroir` à
-- `upper(regexp_replace(valeur, '\s+', '', 'g'))` d'eux-mêmes. Trois conséquences :
--   1. Deux magasiniers qui tapent « B3 », « b3 » ou « B 3 » convergent vers LA MÊME valeur stockée
--      dès lors que la couche applicative normalise avant écriture (zod `schemaCasier`,
--      packages/shared/src/contrats/pieces/primitives.ts — MÊME transformation, trim + suppression
--      des espaces + majuscule, pour qu'aucun INSERT applicatif ne puisse jamais violer ce CHECK).
--   2. Le CHECK est le FILET, pas le mécanisme (doctrine du dépôt) : un futur bug applicatif qui
--      oublierait de normaliser est REJETÉ en base, jamais silencieusement accepté sous une
--      seconde graphie qui romprait l'égalité promise.
--   3. Aucun INDEX dédié n'est posé ici : rien dans ce lot ne filtre par rayon (l'écran fiche
--      article et la recherche comptoir affichent le casier d'un article déjà identifié, ils ne
--      listent jamais « tous les articles du rayon B3 ») — un index sans requête qui l'exploite
--      serait un coût d'écriture sans bénéfice de lecture. À reconsidérer si un écran d'inventaire
--      par rayon apparaît (hors périmètre de ce lot).
--
-- PAS DE CHECK DE LONGUEUR — même décision, même raisonnement que `emplacement` (0044, §C de son
-- en-tête, vérifié en exécution : `stock_article.emplacement` est un `text` nu sans CHECK de
-- longueur dans ce dépôt) : borne applicative uniquement (zod `.trim().max(20)`, contrat hors
-- périmètre schéma — un rayon/tiroir est un code court par nature, 20 caractères est déjà large).
--
-- PAS DE TRIGGER D'AUDIT NI D'ENTRÉE `entite_auditee` — même doctrine que `emplacement` (0025) et
-- `emplacement_libre` (0044) : une case de rangement est une aide à la mémoire d'inventaire, pas
-- un fait auditable au sens `stock_article`/`mouvement_stock` (RP-16→RP-18, où l'argent et la
-- traçabilité de quantité sont engagés). `stock_article_touche_modifie_le` (trigger générique déjà
-- posé en 0025) avance déjà `modifie_le` sur CETTE table pour TOUT champ modifié, `emplacement`
-- compris — comportement existant, inchangé, auquel rayon/tiroir se joignent simplement (à la
-- différence de `vehicule.emplacement_libre`/`emplacement_maj_le`, 0044, qui vit sur une table sans
-- ce trigger générique et a dû se doter d'un horodatage dédié : pas le cas ici).
--
-- EXPAND PUR : deux colonnes nullables, aucune valeur par défaut, aucune ligne existante touchée.
-- Réversible : migrations/down/0056_stock_article_rayon_tiroir.down.sql — DROP COLUMN retire
-- automatiquement les CHECK qui ne portent que sur la colonne retirée (aucun DROP CONSTRAINT
-- explicite nécessaire), schéma après down IDENTIQUE bit à bit au schéma d'avant.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonnes — expand pur, nullables, aucune valeur par défaut inventée.
-- ---------------------------------------------------------------------------------------------

alter table public.stock_article
  add column rayon  text null,
  add column tiroir text null;

comment on column public.stock_article.rayon is
  'Rayon du casier de rangement (RP-11 étendu, complément STRUCTURÉ de `emplacement`, jamais un '
  'remplacement) — facultatif, par (tenant, article, site) comme `emplacement`. Toujours stocké '
  'dans sa forme canonique (majuscules, aucun espace interne, CHECK '
  'stock_article_rayon_normalise_chk) : "B3", "b3" et "B 3" convergent vers la même valeur écrite, '
  'à condition que l''écriture passe par la normalisation applicative (zod `schemaCasier`) — le '
  'CHECK est le filet qui refuse toute écriture qui l''aurait oubliée, jamais le mécanisme '
  'principal.';
comment on column public.stock_article.tiroir is
  'Tiroir du casier de rangement, à l''intérieur du rayon — mêmes règles, même CHECK de '
  'normalisation (stock_article_tiroir_normalise_chk) que `rayon`. Aucun troisième niveau '
  '« allée » : écarté explicitement (@laupernoe, 14.08.2026) comme inutile pour un magasin qui tient dans '
  'une pièce.';


-- ---------------------------------------------------------------------------------------------
-- 2. Normalisation en base — filet, pas mécanisme (la couche applicative normalise déjà à
--    l'écriture, packages/shared/src/contrats/pieces/primitives.ts::schemaCasier).
-- ---------------------------------------------------------------------------------------------

alter table public.stock_article
  add constraint stock_article_rayon_normalise_chk
  check (
    rayon is null
    or (rayon <> '' and rayon = upper(regexp_replace(rayon, '\s+', '', 'g')))
  );

alter table public.stock_article
  add constraint stock_article_tiroir_normalise_chk
  check (
    tiroir is null
    or (tiroir <> '' and tiroir = upper(regexp_replace(tiroir, '\s+', '', 'g')))
  );


-- ---------------------------------------------------------------------------------------------
-- 3. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stock_article'
       and column_name = 'rayon' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0056 : stock_article.rayon absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'stock_article'
       and column_name = 'tiroir' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0056 : stock_article.tiroir absente, non-nullable, ou de mauvais type.';
  end if;

  if exists (
    select 1 from public.stock_article where rayon is not null or tiroir is not null
  ) then
    raise exception '0056 : une ligne de stock_article porte déjà une valeur non-NULL sur rayon/tiroir juste après la migration — expand pur violé.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.stock_article'::regclass
       and conname = 'stock_article_rayon_normalise_chk'
  ) then
    raise exception '0056 : stock_article_rayon_normalise_chk absente après la migration.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.stock_article'::regclass
       and conname = 'stock_article_tiroir_normalise_chk'
  ) then
    raise exception '0056 : stock_article_tiroir_normalise_chk absente après la migration.';
  end if;

  -- Preuve positive que le CHECK rejette bien une valeur non canonique (minuscule) — pas
  -- seulement présente, mais EFFECTIVE. Le CHECK est appliqué par la couche heap à l'insertion,
  -- AVANT tout déclencheur de contrainte FK (celles-ci s'exécutent en trigger AFTER ROW) : la
  -- ligne ci-dessous ne peut donc jamais atteindre une violation de FK avant d'avoir déjà buté sur
  -- le CHECK.
  begin
    insert into public.stock_article (tenant_id, article_id, site_id, rayon)
    values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
            '00000000-0000-0000-0000-000000000000', 'b3');
    raise exception '0056 : stock_article_rayon_normalise_chk n''a PAS rejeté une valeur non canonique ("b3").';
  exception
    when check_violation then null; -- attendu : le CHECK a fait son travail.
  end;
end
$$;
