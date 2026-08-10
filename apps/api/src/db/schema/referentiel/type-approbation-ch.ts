/**
 * Référentiel véhicules suisse — `type_approbation_ch` (migration 0050).
 *
 * Miroir Drizzle de `migrations/0050_referentiel_vehicules_ch.sql` : voir l'en-tête de cette
 * migration pour l'arbitrage complet (choix TAS vs TARGA, volume mesuré, bilinguisme sans
 * duplication de table, les trois modes de saisie et pourquoi `vehicule.marque/modele/version`
 * restent du texte libre). Ce fichier ne fait que TYPER ce que la migration a créé — aucune
 * décision n'est prise ici qui ne soit déjà justifiée là-bas.
 *
 * SANS `tenant_id` NI RLS, ET C'EST VOULU : donnée ASTRA identique pour tous les tenants,
 * déclarée `[dfa:referentiel-partage]` en base — `dfa_app` n'y a que SELECT. Ne pas ajouter de
 * colonne `tenant_id` ici « pour uniformiser » : ce serait exactement l'erreur que la déclaration
 * en base existe pour empêcher (voir 0002_posture_declaree.sql).
 *
 * `type_approbation_ch_marque_modele_recherche_idx` (index composite d'expression, `text_pattern_ops`
 * sur `normaliser_recherche(marque)`/`normaliser_recherche(modele)`) N'EST PAS mirroré ici, par
 * choix : même doctrine que `client_recherche_idx` et `vehicule_vin_recherche_idx` (0006/0007,
 * jamais repris en Drizzle) — les index d'expression sur fonction restent décrits UNIQUEMENT dans
 * la migration SQL, qui fait foi ; `drizzle-kit generate` les signalera comme drift attendu, pas
 * comme un oubli.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const typeApprobationCh = pgTable(
  'type_approbation_ch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** ASTRA `chTypeApprovalNumber` — le « code type » du permis de circulation. Unique. */
    codeTypeCh: text('code_type_ch').notNull(),
    /** ASTRA `vehicleCategoryCode` (M1, N1, L3e, O1…) — code ouvert, pas un enum. */
    categorie: text('categorie').notNull(),
    marque: text('marque').notNull(),
    marqueCode: text('marque_code'),
    modele: text('modele').notNull(),
    typeTechnique: text('type_technique'),
    variante: text('variante'),
    version: text('version'),
    /** ASTRA `chFuelType` — code brut, décodé côté applicatif (i18n), jamais en enum Postgres. */
    carburantCode: text('carburant_code'),
    /** ASTRA `driveType` — code brut, même doctrine que `carburantCode`. */
    transmissionCode: text('transmission_code'),
    moteurDesignation: text('moteur_designation'),
    cylindreeCm3: integer('cylindree_cm3'),
    puissanceKw: integer('puissance_kw'),
    poidsVideKg: integer('poids_vide_kg'),
    poidsTotalKg: integer('poids_total_kg'),
    places: smallint('places'),
    dateHomologation: date('date_homologation'),
    /** ASTRA `versionNo` — brut, aucune signification métier ajoutée ici. */
    sourceVersionNo: integer('source_version_no').notNull().default(0),
    creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    modifieLe: timestamp('modifie_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('type_approbation_ch_code_type_ch_uk').on(t.codeTypeCh),
    check('type_approbation_ch_code_type_ch_non_vide_chk', sql`length(btrim(${t.codeTypeCh})) > 0`),
    check('type_approbation_ch_categorie_non_vide_chk', sql`length(btrim(${t.categorie})) > 0`),
    check('type_approbation_ch_marque_non_vide_chk', sql`length(btrim(${t.marque})) > 0`),
    check('type_approbation_ch_modele_non_vide_chk', sql`length(btrim(${t.modele})) > 0`),
    check(
      'type_approbation_ch_cylindree_chk',
      sql`${t.cylindreeCm3} is null or ${t.cylindreeCm3} >= 0`,
    ),
    check(
      'type_approbation_ch_puissance_chk',
      sql`${t.puissanceKw} is null or ${t.puissanceKw} >= 0`,
    ),
    check(
      'type_approbation_ch_poids_vide_chk',
      sql`${t.poidsVideKg} is null or ${t.poidsVideKg} >= 0`,
    ),
    check(
      'type_approbation_ch_poids_total_chk',
      sql`${t.poidsTotalKg} is null or ${t.poidsTotalKg} >= 0`,
    ),
    check('type_approbation_ch_places_chk', sql`${t.places} is null or ${t.places} > 0`),
    check('type_approbation_ch_source_version_chk', sql`${t.sourceVersionNo} >= 0`),
  ],
);

export type LigneTypeApprobationCh = typeof typeApprobationCh.$inferSelect;
export type NouveauTypeApprobationCh = typeof typeApprobationCh.$inferInsert;
