/**
 * Module pièces — `parametre_pieces`. §10 (PP-01→PP-08, sauf PP-04 non stocké et PP-08 porté par
 * `stock_article`). Détail des règles : migrations/0028_pieces_parametrage.sql.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, smallint, uuid } from 'drizzle-orm/pg-core';

import { colonnesHorodatage } from '../colonnes-communes';
import { tenant } from '../tenant';
import { methodePrixAchatEnum } from './enums';

/** Une ligne par tenant — PK confondue avec `tenant_id`, même patron que `parametre_atelier`. */
export const parametrePieces = pgTable(
  'parametre_pieces',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    stockAutresSitesVisible: boolean('stock_autres_sites_visible').notNull().default(true),
    stockNegatifForcageAutorise: boolean('stock_negatif_forcage_autorise').notNull().default(false),
    /** PP-03 : NULL tant que @laupernoe ne tranche pas (QP-04) — aucune valeur inventée. */
    methodePrixAchat: methodePrixAchatEnum('methode_prix_achat'),
    /** PP-05 : NULL tant que @laupernoe ne tranche pas (QP-11) — aucune valeur inventée. */
    seuilValeurAjustementSignificatifCentimes: integer('seuil_valeur_ajustement_significatif_centimes'),
    /** PP-06 : NULL tant que @laupernoe ne tranche pas (QP-07) — aucune valeur inventée. */
    delaiConsigneAcquisitionJours: smallint('delai_consigne_acquisition_jours'),
    tauxTvaConsignePourmille: smallint('taux_tva_consigne_pourmille').notNull().default(81),

    ...colonnesHorodatage(),
  },
  (t) => [
    check(
      'parametre_pieces_seuil_ajustement_chk',
      sql`${t.seuilValeurAjustementSignificatifCentimes} is null or ${t.seuilValeurAjustementSignificatifCentimes} >= 0`,
    ),
    check(
      'parametre_pieces_delai_consigne_chk',
      sql`${t.delaiConsigneAcquisitionJours} is null or ${t.delaiConsigneAcquisitionJours} between 0 and 3650`,
    ),
    check('parametre_pieces_taux_tva_consigne_chk', sql`${t.tauxTvaConsignePourmille} between 0 and 1000`),
  ],
);

export type LigneParametrePieces = typeof parametrePieces.$inferSelect;
export type NouveauParametrePieces = typeof parametrePieces.$inferInsert;
