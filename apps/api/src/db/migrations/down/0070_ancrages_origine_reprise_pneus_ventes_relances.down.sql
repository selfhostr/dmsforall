-- =============================================================================================
-- 0070_ancrages_origine_reprise_pneus_ventes_relances.down.sql — annulation de 0070.
--
-- Aucun type PG créé par 0070 (réutilise `origine_document` de 0010, qui reste en place tant que
-- 0010 n'est pas défaite séparément) : le down se limite, pour chacune des sept tables, à l'index
-- unique partiel, la contrainte CHECK et les deux colonnes d'ancrage, dans l'ordre inverse de leur
-- création — même patron que down/0066_ancrages_origine_reprise.down.sql. `relance_planifiee`
-- défait en plus sa colonne `note_reprise` (et sa CHECK) avant ses deux colonnes d'ancrage, dans
-- l'ordre inverse de la création (§7 du up).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 7. `relance_planifiee`
-- ---------------------------------------------------------------------------------------------

alter table public.relance_planifiee
  drop constraint if exists relance_planifiee_note_reprise_non_vide_chk;

alter table public.relance_planifiee
  drop column if exists note_reprise;

drop index if exists public.relance_planifiee_numero_origine_uk;

alter table public.relance_planifiee
  drop constraint if exists relance_planifiee_origine_numero_origine_chk;

alter table public.relance_planifiee
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 6. `financement_vente`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.financement_vente_numero_origine_uk;

alter table public.financement_vente
  drop constraint if exists financement_vente_origine_numero_origine_chk;

alter table public.financement_vente
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 5. `reprise`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.reprise_numero_origine_uk;

alter table public.reprise
  drop constraint if exists reprise_origine_numero_origine_chk;

alter table public.reprise
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 4. `vehicule_stock`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.vehicule_stock_numero_origine_uk;

alter table public.vehicule_stock
  drop constraint if exists vehicule_stock_origine_numero_origine_chk;

alter table public.vehicule_stock
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 3. `dossier_vente`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.dossier_vente_numero_origine_uk;

alter table public.dossier_vente
  drop constraint if exists dossier_vente_origine_numero_origine_chk;

alter table public.dossier_vente
  drop column if exists numero_origine,
  drop column if exists origine;

-- ---------------------------------------------------------------------------------------------
-- 2. `commande_fournisseur` — ancrage nommé `origine_reprise` (pas `origine`, déjà pris, 0024).
-- ---------------------------------------------------------------------------------------------

drop index if exists public.commande_fournisseur_numero_origine_uk;

alter table public.commande_fournisseur
  drop constraint if exists commande_fournisseur_origine_numero_origine_chk;

alter table public.commande_fournisseur
  drop column if exists numero_origine,
  drop column if exists origine_reprise;

-- ---------------------------------------------------------------------------------------------
-- 1. `depot_pneus`
-- ---------------------------------------------------------------------------------------------

drop index if exists public.depot_pneus_numero_origine_uk;

alter table public.depot_pneus
  drop constraint if exists depot_pneus_origine_numero_origine_chk;

alter table public.depot_pneus
  drop column if exists numero_origine,
  drop column if exists origine;
