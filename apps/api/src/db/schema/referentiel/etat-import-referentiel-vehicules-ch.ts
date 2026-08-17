/**
 * Miroir Drizzle de `migrations/0057_referentiel_vehicules_ch_etat_import.sql` — voir l'en-tête
 * de cette migration pour l'arbitrage complet (singleton, sémantique des trois dates, posture
 * `[dfa:referentiel-partage]`). Ce fichier ne fait que TYPER ce que la migration a créé.
 *
 * SANS `tenant_id` NI RLS, MÊME DOCTRINE QUE `type-approbation-ch.ts` : cet état décrit le
 * référentiel PARTAGÉ (0050), pas une donnée de garage. `dfa_app` n'y a que SELECT ; seul le job
 * d'import (`vehicules/referentiel/etat-import-referentiel-vehicules-ch.ts`, connexion
 * `DATABASE_URL_MIGRATION`) y écrit — jamais via `AccesBase`/`JETON_DB`.
 */

import { boolean, check, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Miroir de `public.referentiel_vehicules_ch_issue_import` (0057). */
export const referentielVehiculesChIssueImportEnum = pgEnum(
  'referentiel_vehicules_ch_issue_import',
  ['succes', 'inchange', 'echec'],
);

export const referentielVehiculesChEtatImport = pgTable(
  'referentiel_vehicules_ch_etat_import',
  {
    /** Singleton : toujours `true`, voir 0057 § 2. */
    id: boolean('id').primaryKey().default(true),
    derniereVerificationLe: timestamp('derniere_verification_le', {
      withTimezone: true,
      mode: 'date',
    }),
    derniereIssue: referentielVehiculesChIssueImportEnum('derniere_issue'),
    dernierImportReussiLe: timestamp('dernier_import_reussi_le', {
      withTimezone: true,
      mode: 'date',
    }),
    dernierNombreLignes: integer('dernier_nombre_lignes'),
    signatureSource: text('signature_source'),
    dernierMotifEchec: text('dernier_motif_echec'),
    echecsConsecutifs: integer('echecs_consecutifs').notNull().default(0),
    modifieLe: timestamp('modifie_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'referentiel_vehicules_ch_etat_import_lignes_chk',
      sql`${t.dernierNombreLignes} is null or ${t.dernierNombreLignes} >= 0`,
    ),
    check('referentiel_vehicules_ch_etat_import_echecs_chk', sql`${t.echecsConsecutifs} >= 0`),
  ],
);

export type LigneEtatImportReferentielVehiculesCh =
  typeof referentielVehiculesChEtatImport.$inferSelect;
export type NouvelEtatImportReferentielVehiculesCh =
  typeof referentielVehiculesChEtatImport.$inferInsert;
