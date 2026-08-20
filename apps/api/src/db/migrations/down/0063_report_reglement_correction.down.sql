-- =============================================================================================
-- 0063_report_reglement_correction.down.sql — inverse de 0063_report_reglement_correction.sql
-- (§1, issue #154, ET §2, issue #156).
--
-- Schéma après ce down identique bit à bit au schéma d'avant la migration montante. Migration de
-- données : aucune (table `report_reglement_correction` neuve, jamais alimentée avant cette
-- migration montante ; colonne `document_vente.facture_corrigee_id` neuve, expand pur, jamais
-- non-NULL avant ce down — voir l'assertion de fin du up). Aucun type Postgres créé par 0063
-- (aucun enum ajouté, `entite_auditee` volontairement non touché — voir l'en-tête du up), donc
-- rien d'autre à retirer que la table et la colonne elles-mêmes. Ordre : §2 avant §1 (inverse
-- strict du up) — `DROP COLUMN` retire d'elle-même la contrainte FK/CHECK et l'index partiel qui
-- en dépendent, aucun `DROP CONSTRAINT`/`DROP INDEX` explicite nécessaire.
-- =============================================================================================

alter table public.document_vente
  drop column if exists facture_corrigee_id;

drop table if exists public.report_reglement_correction;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.report_reglement_correction') is not null then
    raise exception '0063 down : table report_reglement_correction toujours présente après le down.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'document_vente'
       and column_name = 'facture_corrigee_id'
  ) then
    raise exception '0063 down : document_vente.facture_corrigee_id toujours présente après le down.';
  end if;
end
$$;
