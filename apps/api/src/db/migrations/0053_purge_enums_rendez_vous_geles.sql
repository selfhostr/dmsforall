-- =============================================================================================
-- 0053_purge_enums_rendez_vous_geles.sql — retire les deux types Postgres orphelins
-- `statut_rendez_vous` / `origine_rendez_vous`, résidus de `0005_parametrage.sql`.
--
-- CONTEXTE (dette technique n°3) — mesuré en exécution avant d'écrire cette migration :
--
--   `0005_parametrage.sql` (§ « Modules absents du lot 1 : enums créés quand même ») a posé ces
--   deux types PAR ANTICIPATION d'un module rendez-vous qui n'existait pas encore, avec des
--   valeurs qui reflétaient `STATUTS_RENDEZ_VOUS`/`ORIGINES_RENDEZ_VOUS` — deux enums marqués
--   **GELÉ** dans `@dfa/shared` (`packages/shared/src/contrats/atelier/enums.ts`), jamais
--   implémentés. `0052_rendez_vous_atelier.sql` a ensuite implémenté le VRAI module rendez-vous et
--   découvert la collision de noms (voir son en-tête §A) : les valeurs arbitrées par @laupernoe pour ce
--   chantier (`confirme/honore/absent/annule`, `reservation/retroactif`) sont sémantiquement
--   DIFFÉRENTES de ce que ces deux types portent, donc 0052 a créé ses propres types sous des noms
--   voisins (`statut_prise_rendez_vous`, `origine_creation_rendez_vous`) plutôt que de réutiliser
--   ceux-ci, laissant `statut_rendez_vous`/`origine_rendez_vous` en place, inertes, et signalant
--   « réconciliation ultérieure » pour qui toucherait `@dfa/shared`.
--
--   Vérifié en exécution sur `dfa_dev` avant d'écrire cette migration (requête ci-dessous) :
--
--     select enumlabel from pg_enum join pg_type on pg_type.oid = enumtypid
--      where typname in ('statut_rendez_vous', 'origine_rendez_vous')
--      order by enumtypid, enumsortorder;
--
--   → confirme que les deux types existent bien en base, avec exactement les valeurs GELÉES
--   (`demande, planifie, honore, absent, annule_client, annule_garage, reporte` et
--   `telephone, comptoir, email, formulaire_web, importe, rappel_automatique`) — donc FAUSSES au
--   sens de l'arbitrage de @laupernoe pour le domaine rendez-vous. Vérifié aussi : AUCUNE colonne d'AUCUNE
--   table n'a `udt_name` égal à l'un de ces deux types (`information_schema.columns`), et aucune
--   dépendance normale ne pointe vers eux (`pg_depend`, `deptype = 'n'`) — le résidu est inerte,
--   pas seulement gênant.
--
-- DÉCISION : puisque personne ne les consomme et que leurs valeurs sont la spéculation morte que
-- @laupernoe a explicitement écartée, la correction est un retrait pur, pas une réécriture de valeurs
-- (`ALTER TYPE ... RENAME VALUE`/ajout ne permettent de toute façon pas de retirer une valeur en
-- PostgreSQL — un enum gelé aux mauvaises valeurs ne se « corrige » pas sur place). Le modèle qui
-- fait foi reste `statut_prise_rendez_vous`/`origine_creation_rendez_vous` (0052), inchangés ici.
--
-- Migration de DONNÉES : aucune — confirmé ci-dessus qu'aucune colonne n'utilise ces types.
--
-- Réversible : migrations/down/0053_purge_enums_rendez_vous_geles.down.sql recrée les deux types
-- à l'IDENTIQUE (mêmes noms, mêmes valeurs, même ordre) — aller-retour complet, aucune exception à
-- déclarer dans `scripts/verifier-reversibilite-migrations.sh`.
-- =============================================================================================

drop type public.statut_rendez_vous;
drop type public.origine_rendez_vous;


-- ---------------------------------------------------------------------------------------------
-- Assertions de fin de migration.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_type where typname = 'statut_rendez_vous') then
    raise exception '0053 : type statut_rendez_vous toujours présent après la migration.';
  end if;

  if exists (select 1 from pg_catalog.pg_type where typname = 'origine_rendez_vous') then
    raise exception '0053 : type origine_rendez_vous toujours présent après la migration.';
  end if;

  -- Les types réellement consommés par `rendez_vous` (0052) restent intacts.
  if not exists (select 1 from pg_catalog.pg_type where typname = 'statut_prise_rendez_vous') then
    raise exception '0053 : type statut_prise_rendez_vous absent après la migration (ne devait pas être touché).';
  end if;

  if not exists (select 1 from pg_catalog.pg_type where typname = 'origine_creation_rendez_vous') then
    raise exception '0053 : type origine_creation_rendez_vous absent après la migration (ne devait pas être touché).';
  end if;
end
$$;
