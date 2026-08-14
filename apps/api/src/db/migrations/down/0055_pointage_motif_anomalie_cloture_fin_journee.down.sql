-- =============================================================================================
-- 0055_pointage_motif_anomalie_cloture_fin_journee.down.sql — annulation de
-- 0055_pointage_motif_anomalie_cloture_fin_journee.sql
--
-- NE PEUT PAS retirer la valeur `cloture_fin_journee` de `motif_anomalie_pointage` — PostgreSQL
-- n'offre aucun « DROP VALUE » sur un type enum existant (même limite acceptée que
-- 0016/0021/0023/0033) : elle reste dans le type, sans effet observable tant qu'aucune ligne de
-- `pointage.anomalie_motif` ne la porte — ce que ce down NE VÉRIFIE PAS explicitement (aucune
-- ligne n'a pu la porter avant ce down : la valeur n'existait pas avant le up de cette migration
-- au sein d'un même cycle up->down->up de CI, et `ServiceClotureAutomatiquePointage` n'écrit
-- jamais en dehors d'une requête applicative postérieure à un up réellement déployé). Migration
-- de DONNÉES : aucune — le up n'a ajouté qu'une valeur d'énumération, jamais touché la moindre
-- ligne.
--
-- Volontairement AUCUNE INSTRUCTION SQL ci-dessous au-delà des assertions : il n'y a rien
-- d'autre à défaire (pas de colonne, pas de contrainte, pas de trigger posés par le up — voir son
-- en-tête, §« CE QU'ELLE NE FAIT PAS »).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de down
-- ---------------------------------------------------------------------------------------------

do $$
begin
  -- Le type existe toujours (ce down ne le supprime pas) et porte toujours les sept valeurs
  -- d'origine — seule propriété que ce down peut réellement garantir.
  if (
    select count(*) from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'motif_anomalie_pointage'
       and e.enumlabel in (
         'duree_trop', 'nuit', 'chevauchement', 'periode_verrouillee', 'or_facture',
         'ligne_non_pointable', 'derive_horloge'
       )
  ) <> 7 then
    raise exception '0055 down : au moins une des sept valeurs d''origine de motif_anomalie_pointage a disparu.';
  end if;
end
$$;
