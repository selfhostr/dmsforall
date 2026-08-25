-- =============================================================================================
-- 0066_ancrages_origine_reprise.down.sql — annulation de 0066.
--
-- Aucun type PG créé par 0066 (réutilise `origine_document` de 0010, qui reste en place tant que
-- 0010 n'est pas défaite séparément) : le down se limite, pour chacune des cinq tables, à l'index
-- unique partiel, la contrainte CHECK et les deux colonnes, dans l'ordre inverse de leur création
-- — même patron que down/0011_ordre_reparation_origine_reprise.down.sql.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 5. `paiement`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.paiement_numero_origine_uk;

alter table public.paiement
  drop constraint if exists paiement_origine_numero_origine_chk;

alter table public.paiement
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 4. `fournisseur`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.fournisseur_numero_origine_uk;

alter table public.fournisseur
  drop constraint if exists fournisseur_origine_numero_origine_chk;

alter table public.fournisseur
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 3. `article`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.article_numero_origine_uk;

alter table public.article
  drop constraint if exists article_origine_numero_origine_chk;

alter table public.article
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 2. `vehicule`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.vehicule_numero_origine_uk;

alter table public.vehicule
  drop constraint if exists vehicule_origine_numero_origine_chk;

alter table public.vehicule
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 1. `client`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.client_numero_origine_uk;

alter table public.client
  drop constraint if exists client_origine_numero_origine_chk;

alter table public.client
  drop column if exists numero_origine,
  drop column if exists origine;
