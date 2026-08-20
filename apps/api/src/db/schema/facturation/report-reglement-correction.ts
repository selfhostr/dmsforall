/**
 * `report_reglement_correction` — issue #154, migration 0063. Append-only : quand
 * `ServiceCorrectionFacture.corriger` annule une facture réglée par avoir puis en émet une de
 * remplacement, le montant réglé est reporté ici plutôt que perdu. Voir l'en-tête de
 * `0063_report_reglement_correction.sql` pour le raisonnement complet (pourquoi une table à part,
 * jamais une réaffectation de `imputation_paiement`, immuable).
 */

import { bigint, check, foreignKey, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneCreeLe, colonneId, colonneTenantId } from '../colonnes-communes';
import { utilisateur } from '../utilisateur';
import { documentVente } from './document-vente';

export const reportReglementCorrection = pgTable(
  'report_reglement_correction',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    /** La facture ANNULÉE par l'avoir — d'où le montant venait. */
    factureOrigineId: uuid('facture_origine_id').notNull(),
    /** La facture émise en remplacement — où le montant est reporté. */
    factureRemplacementId: uuid('facture_remplacement_id').notNull(),
    montantCentimes: bigint('montant_centimes', { mode: 'bigint' }).notNull(),
    creeLe: colonneCreeLe(),
    creeParId: uuid('cree_par_id'),
  },
  (t) => [
    unique('report_reglement_correction_tenant_id_uk').on(t.tenantId, t.id),
    unique('report_reglement_correction_uk_origine').on(t.tenantId, t.factureOrigineId),
    foreignKey({
      name: 'report_reglement_correction_fk_facture_origine',
      columns: [t.tenantId, t.factureOrigineId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'report_reglement_correction_fk_facture_remplacement',
      columns: [t.tenantId, t.factureRemplacementId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'report_reglement_correction_fk_cree_par',
      columns: [t.tenantId, t.creeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('report_reglement_correction_montant_positif_chk', sql`${t.montantCentimes} > 0`),
    check(
      'report_reglement_correction_origine_distincte_remplacement_chk',
      sql`${t.factureOrigineId} <> ${t.factureRemplacementId}`,
    ),
  ],
);

export type LigneReportReglementCorrection = typeof reportReglementCorrection.$inferSelect;
