-- =============================================================================================
-- 0044_vehicule_emplacement_libre.sql — Plan du parc, Lot C simplifié (colonnes seulement).
-- Spécification : docs/specification-parc-et-hangar-pneus.md §4.2 (extension de vehicule), §7
-- (« version simplifiée qui capture 80% de la valeur pour 20% du travail »), §8 (Lot C).
--
-- CE QUI EST POSÉ ICI — pur ALTER TABLE additif (expand), aucune donnée existante touchée :
--   emplacement_libre    text        null   -- patron stock_article.emplacement (§4.2)
--   emplacement_maj_le   timestamptz null   -- dernière fois où la position a été touchée
--
-- CE QUI N'EST PAS POSÉ ICI — DÉLIBÉRÉMENT, PAS UN OUBLI :
--   `emplacement_parc_id` (§4.2 de la spec le mentionne, mais comme partie du Lot D CONDITIONNEL,
--   §7-8) : référencerait une table `emplacement_parc` (§4.1) qui n'existe pas encore et reste
--   différée tant que la version simplifiée (ce Lot C) n'a pas montré ses limites en usage réel
--   chez un premier garage (§7, recommandation de @laupernoe/expert-metier). Ajouter cette colonne
--   maintenant créerait soit une FK vers une table absente (migration invalide), soit une colonne
--   orpheline sans table cible — aucune des deux options n'est acceptable.
--
--   Pas de CHECK de longueur sur `emplacement_libre` — même décision et même raisonnement que
--   `code_case` sur `depot_pneus` (0043, §C de son en-tête, vérifié en exécution :
--   `stock_article.emplacement` est un `text` nu sans CHECK dans ce dépôt) : borne applicative
--   uniquement (zod `.trim().max(60)`, contrat hors périmètre schéma).
--
--   Pas de trigger d'audit ni d'entrée dans `entite_auditee` : la spec (§1.1, §1.3) est explicite
--   — « le champ emplacement d'un véhicule indique la dernière position connue, ce n'est pas une
--   vérité d'inventaire auditée » — à l'opposé exact de `depot_pneus` (0043), où « l'argent et la
--   responsabilité sont engagés » (spec §1.2) justifie l'audit. Deux tables sœurs de la même
--   spec, deux doctrines délibérément différentes.
--
--   Pas de trigger touche_modifie_le : `emplacement_maj_le` n'est PAS `modifie_le` — c'est un
--   horodatage métier maintenu par l'APPLICATIF au moment précis où la position est modifiée
--   (§4.2 : « dernière fois où la position a été touchée »), distinct du `modifie_le` générique de
--   `vehicule` qui avance sur N'IMPORTE QUELLE colonne (marque, VIN, statut, …). Un trigger
--   générique sur `modifie_le` écrirait `emplacement_maj_le` à chaque modification du véhicule,
--   pas seulement quand sa position change — faux sens précisément sur le champ qui sert à savoir
--   *quand* la voiture a été vue au dernier endroit connu.
--
-- SIGNALÉ, PAS FAIT ICI (hors périmètre déclaré de cette tâche) : `vehicule` est défini en
-- `apps/api/src/db/schema/atelier/vehicule.ts`, propriété d'un autre agent cette vague. Le miroir
-- Drizzle TypeScript reste à ajouter séparément par ce propriétaire :
--   emplacementLibre: text('emplacement_libre'),
--   emplacementMajLe: timestamp('emplacement_maj_le', { withTimezone: true, mode: 'date' }),
-- à l'objet `vehicule` (pgTable), avec les imports `text`/`timestamp` déjà présents dans ce
-- fichier (utilisés par d'autres colonnes).
--
-- Réversible : migrations/down/0044_vehicule_emplacement_libre.down.sql. Le DOWN retire les deux
-- colonnes — aucune limite PostgreSQL ici (pas d'ALTER TYPE ADD VALUE dans cette migration), le
-- schéma après down doit être IDENTIQUE bit à bit au schéma d'avant, sans exception à déclarer
-- dans scripts/verifier-reversibilite-migrations.sh. Migration de DONNÉES : aucune — colonnes
-- neuves, entièrement NULL sur les lignes existantes (expand pur, vérifié par assertion ci-après).
-- =============================================================================================


-- ---------------------------------------------------------------------------------------------
-- 1. Colonnes — expand pur, nullables, aucune valeur par défaut inventée.
-- ---------------------------------------------------------------------------------------------

alter table public.vehicule
  add column emplacement_libre  text        null,
  add column emplacement_maj_le timestamptz null;

comment on column public.vehicule.emplacement_libre is
  'Position courante déclarative du véhicule (Lot C, plan du parc simplifié) — texte libre, '
  'patron stock_article.emplacement, borne .trim().max(60) applicative uniquement. Une aide à la '
  'mémoire visuelle, PAS une vérité d''inventaire auditée (spec §1.1/§1.3) : peut être fausse un '
  'moment sans casser le système, aucune contrainte d''unicité (RPA-03).';
comment on column public.vehicule.emplacement_maj_le is
  'Dernière fois où emplacement_libre a été touché — maintenu par l''applicatif au moment précis '
  'de la modification de position, PAS par un trigger générique sur modifie_le (qui avancerait '
  'sur toute modification du véhicule, pas seulement sa position).';


-- ---------------------------------------------------------------------------------------------
-- 2. Assertions de fin de migration
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule'
       and column_name = 'emplacement_libre' and is_nullable = 'YES' and data_type = 'text'
  ) then
    raise exception '0044 : vehicule.emplacement_libre absente, non-nullable, ou de mauvais type.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicule'
       and column_name = 'emplacement_maj_le' and is_nullable = 'YES'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception '0044 : vehicule.emplacement_maj_le absente, non-nullable, ou de mauvais type.';
  end if;

  if exists (
    select 1 from public.vehicule
     where emplacement_libre is not null or emplacement_maj_le is not null
  ) then
    raise exception '0044 : une ligne de vehicule porte déjà une valeur non-NULL sur emplacement_libre/emplacement_maj_le juste après la migration — expand pur violé.';
  end if;
end
$$;
