-- =============================================================================================
-- 0057_referentiel_vehicules_ch_etat_import.down.sql — inverse de
-- 0057_referentiel_vehicules_ch_etat_import.sql
--
-- MIGRATION DE DONNÉES : aucune à préserver. Cette table ne porte qu'un état de contrôle
-- recalculable au prochain passage du job (jamais une saisie utilisateur) — la perdre au
-- rollback ne fait perdre que la date du dernier contrôle connu, retrouvée au passage suivant.
-- =============================================================================================

drop trigger if exists referentiel_vehicules_ch_etat_import_touche_modifie_le
  on public.referentiel_vehicules_ch_etat_import;

drop table if exists public.referentiel_vehicules_ch_etat_import;

drop type if exists public.referentiel_vehicules_ch_issue_import;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.referentiel_vehicules_ch_etat_import') is not null then
    raise exception '0057 down : table referentiel_vehicules_ch_etat_import toujours présente après le down.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'referentiel_vehicules_ch_issue_import') then
    raise exception '0057 down : type referentiel_vehicules_ch_issue_import toujours présent après le down.';
  end if;
end
$$;
