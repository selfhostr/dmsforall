/**
 * Module pièces — `consigne_echange_standard`. RP-37→RP-42, §6.4, CP-06. Débloque RF-100.
 * Détail des règles et triggers : migrations/0027_pieces_consigne.sql.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { ligneOr, ordreReparation } from '../atelier/ordre-reparation';
import { documentVente, ligneDocument } from '../facturation/document-vente';
import { article } from './article';
import { statutConsigneEchangeStandardEnum } from './enums';
import { mouvementStock } from './stock';

export const consigneEchangeStandard = pgTable(
  'consigne_echange_standard',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ligneOrId: uuid('ligne_or_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    articleId: uuid('article_id').notNull(),
    siteId: uuid('site_id').notNull(),
    statut: statutConsigneEchangeStandardEnum('statut')
      .notNull()
      .default('en_attente_retour_fournisseur'),
    montantConsigneTtcCentimes: integer('montant_consigne_ttc_centimes').notNull(),
    documentVenteLigneConsigneId: uuid('document_vente_ligne_consigne_id'),
    mouvementEntreeId: uuid('mouvement_entree_id').notNull(),
    retourneeFournisseurLe: timestamp('retournee_fournisseur_le', {
      withTimezone: true,
      mode: 'date',
    }),
    mouvementRetourId: uuid('mouvement_retour_id'),
    avoirDocumentId: uuid('avoir_document_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('consigne_echange_standard_tenant_id_uk').on(t.tenantId, t.id),
    unique('consigne_echange_standard_tenant_ligne_or_uk').on(t.tenantId, t.ligneOrId),
    foreignKey({
      name: 'consigne_echange_standard_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_ordre_reparation',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_mouvement_entree',
      columns: [t.tenantId, t.mouvementEntreeId],
      foreignColumns: [mouvementStock.tenantId, mouvementStock.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_mouvement_retour',
      columns: [t.tenantId, t.mouvementRetourId],
      foreignColumns: [mouvementStock.tenantId, mouvementStock.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_document_ligne',
      columns: [t.tenantId, t.documentVenteLigneConsigneId],
      foreignColumns: [ligneDocument.tenantId, ligneDocument.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'consigne_echange_standard_fk_avoir',
      columns: [t.tenantId, t.avoirDocumentId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    check('consigne_echange_standard_montant_chk', sql`${t.montantConsigneTtcCentimes} >= 0`),
    // RP-40, moitié « stock » de « jamais l'un sans l'autre » — voir l'en-tête de la migration
    // pour ce que ce CHECK peut et ne peut pas garantir (l'atomicité avec l'avoir facturation
    // reste cross-module, hors d'atteinte d'un CHECK sur cette seule table).
    check(
      'consigne_echange_standard_terminal_coherent_chk',
      sql`(${t.statut} = 'retournee_fournisseur') = (${t.retourneeFournisseurLe} is not null and ${t.mouvementRetourId} is not null)`,
    ),
    index('consigne_echange_standard_statut_idx').on(t.tenantId, t.statut, t.creeLe),
    index('consigne_echange_standard_site_idx').on(t.tenantId, t.siteId, t.statut),
  ],
);

export type LigneConsigneEchangeStandard = typeof consigneEchangeStandard.$inferSelect;
export type NouvelleConsigneEchangeStandard = typeof consigneEchangeStandard.$inferInsert;
