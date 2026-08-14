-- =============================================================================================
-- 0051_referentiel_vehicules_ch_marque_alias.down.sql — inverse de
-- 0051_referentiel_vehicules_ch_marque_alias.sql
--
-- MIGRATION DE DONNÉES : les 4 lignes curées par 0051 sont perdues par ce down — assumé, cette
-- table est un référentiel produit reconstituable depuis la migration elle-même (source de vérité
-- documentée là, pas une saisie utilisateur qu'on doit préserver).
-- =============================================================================================

drop index if exists public.type_approbation_ch_marque_alias_recherche_uk;

drop trigger if exists type_approbation_ch_marque_alias_touche_modifie_le
  on public.type_approbation_ch_marque_alias;

drop table if exists public.type_approbation_ch_marque_alias;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.type_approbation_ch_marque_alias') is not null then
    raise exception '0051 down : table type_approbation_ch_marque_alias toujours présente après le down.';
  end if;
end
$$;
