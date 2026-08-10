-- =============================================================================================
-- 0050_referentiel_vehicules_ch.down.sql — inverse de 0050_referentiel_vehicules_ch.sql
--
-- Ordre : défait `vehicule` (le dépendant) avant `type_approbation_ch` (la cible) — sinon le
-- `drop table` échouerait sur la FK encore posée, ou exigerait un `cascade` que ce dépôt évite
-- systématiquement (voir la doctrine répétée dans 0043.down, 0049.down, etc.).
--
-- MIGRATION DE DONNÉES : aucune. Cette migration n'a jamais chargé de ligne dans
-- `type_approbation_ch` (l'import est une tâche séparée, non exécutée ici) — le seul risque de
-- perte serait un `type_approbation_ch_id` déjà posé sur un `vehicule` par un import antérieur à
-- ce rollback ; il est perdu avec la colonne, mais `vehicule.marque`/`modele`/`version` (texte
-- libre, jamais touchés par cette migration) restent intacts après ce down, exactement comme
-- avant que 0050 ne soit appliquée.
-- =============================================================================================

-- --- 1. `vehicule` — retirer le lien optionnel -------------------------------------------------

drop index if exists public.vehicule_type_approbation_ch_id_idx;

alter table public.vehicule
  drop constraint if exists vehicule_fk_type_approbation;

alter table public.vehicule
  drop column if exists type_approbation_ch_id;

-- --- 2. `type_approbation_ch` — la table et son trigger ----------------------------------------

drop trigger if exists type_approbation_ch_touche_modifie_le on public.type_approbation_ch;

drop table if exists public.type_approbation_ch;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.type_approbation_ch') is not null then
    raise exception '0050 down : table type_approbation_ch toujours présente après le down.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.vehicule'::regclass
       and attname = 'type_approbation_ch_id'
       and not attisdropped
  ) then
    raise exception '0050 down : colonne vehicule.type_approbation_ch_id toujours présente après le down.';
  end if;
end
$$;
