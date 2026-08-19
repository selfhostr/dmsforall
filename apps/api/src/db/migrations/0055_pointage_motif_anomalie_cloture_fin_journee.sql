-- =============================================================================================
-- 0055_pointage_motif_anomalie_cloture_fin_journee.sql — RM-91/RM-119/CT-57 : la clôture
-- automatique de fin de journée du pointage (`ServiceClotureAutomatiquePointage`,
-- apps/api/src/pointage/service-cloture-automatique-pointage.ts) marque le pointage refermé comme
-- ANOMALIE, pour que le chef d'atelier le voie et corrige la durée réelle le lendemain matin —
-- décision de @laupernoe, 14.08.2026. Aucune des SEPT valeurs existantes de `motif_anomalie_pointage`
-- (0030) ne porte ce sens : `nuit` est un CHEVAUCHEMENT de nuit (deux pointages, horloge en
-- désordre — `pointage:anomalies.motifs.nuit` = « Chevauchement de nuit »), pas un pointage
-- simplement oublié ouvert au-delà de l'heure de fermeture du site. `docs/specification-pointage.
-- md` §3.3/§11/§12 encadre ce motif comme distinct depuis l'origine (RM-91, RM-119, CT-57) — pas
-- un raccourci pris ici.
--
-- CE QUE CETTE MIGRATION FAIT, ET RIEN DE PLUS :
--   1. `motif_anomalie_pointage` gagne la valeur `cloture_fin_journee` (§1 ci-dessous).
-- CE QU'ELLE NE FAIT PAS, ET POURQUOI :
--   - Aucune colonne « heure de fermeture du site » — elle EXISTE DÉJÀ (`parametre_site.
--     heure_cloture_pointage`, P-31, posée par une migration antérieure à celle-ci) : mesuré avant
--     d'écrire cette migration (`apps/api/src/db/schema/atelier/parametrage.ts`), pas supposé.
--     `ServiceClotureAutomatiquePointage` la réutilise telle quelle, aucune nouvelle colonne à
--     poser ici.
--   - Aucun trigger, aucune table : le mécanisme de clôture lui-même est un service applicatif
--     idempotent (réclamation conditionnelle `WHERE statut = 'en_cours'`, voir son en-tête), pas
--     un dispositif base de données — rien à modéliser en SQL au-delà de la valeur d'énumération.
--
-- `ALTER TYPE ... ADD VALUE` PUIS RIEN QUI LA COMPARE DANS LA MÊME TRANSACTION — SÛR ICI, MÊME
-- RAISONNEMENT QUE 0016/0033 (référence directe) : la seule restriction réelle de PostgreSQL est
-- qu'une valeur ajoutée ne doit pas être COMPARÉE (=, tri, cast implicite dans WHERE/ORDER BY)
-- dans la même transaction que celle qui l'a ajoutée. Cette migration n'insère ni ne met à jour
-- aucune ligne portant cette valeur — le premier INSERT/UPDATE qui l'utilisera sera
-- `ServiceClotureAutomatiquePointage`, dans une transaction applicative ultérieure, bien après le
-- COMMIT de cette migration.
--
-- Réversible : `migrations/down/0055_pointage_motif_anomalie_cloture_fin_journee.down.sql`. Le
-- DOWN NE PEUT PAS retirer la valeur `cloture_fin_journee` de `motif_anomalie_pointage` —
-- PostgreSQL n'offre aucun « DROP VALUE » sur un type enum existant (même limite acceptée que
-- 0016/0021/0023/0033) : `IF NOT EXISTS` sur le `ADD VALUE` rend le cycle up->down->up rejouable
-- malgré cela (la valeur reste dans le type après le down, sans effet observable tant qu'aucune
-- ligne ne la porte). Migration de DONNÉES : aucune — expand pur, aucune ligne existante touchée.
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. `motif_anomalie_pointage` gagne `cloture_fin_journee` (§ en-tête).
-- ---------------------------------------------------------------------------------------------

alter type public.motif_anomalie_pointage add value if not exists 'cloture_fin_journee';


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'motif_anomalie_pointage'
       and e.enumlabel = 'cloture_fin_journee'
  ) then
    raise exception '0055 : motif_anomalie_pointage ne porte pas la valeur cloture_fin_journee après migration.';
  end if;

  -- Les sept valeurs d'origine (0030) restent toutes présentes — expand pur, rien retiré.
  if (
    select count(*) from pg_catalog.pg_enum e
      join pg_catalog.pg_type t on t.oid = e.enumtypid
     where t.typname = 'motif_anomalie_pointage'
       and e.enumlabel in (
         'duree_trop', 'nuit', 'chevauchement', 'periode_verrouillee', 'or_facture',
         'ligne_non_pointable', 'derive_horloge'
       )
  ) <> 7 then
    raise exception '0055 : au moins une des sept valeurs d''origine de motif_anomalie_pointage a disparu.';
  end if;
end
$$;
