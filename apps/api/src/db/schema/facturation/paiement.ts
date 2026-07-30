/**
 * Paiements et lettrage — `paiement`, `imputation_paiement`, `bulletin_paiement`.
 * Détail des règles, invariants et triggers : migrations/0010_facturation.sql §10→§12.
 *
 * `paiement.exportId` / `document_vente.exportId` → `export_comptable` : FK différée (migration
 * §14, ALTER TABLE), posée après la création de `export_comptable` — non modélisée ici pour
 * éviter une dépendance circulaire entre fichiers de schéma sans bénéfice de typage réel
 * (`drizzle-kit` ne sert que de contrôle de dérive, voir schema/index.ts).
 *
 * `imputationPaiement.exportId` → `export_comptable` : même choix, migration 0019. C'est là que
 * vit désormais la granularité réelle du suivi d'export comptable (MD-91) — voir 0019 pour la
 * raison : l'écriture comptable naît à l'imputation, pas au paiement.
 */

import type { DeviseFacturation } from '@dfa/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { client } from '../atelier/client';
import { site } from '../site';
import { utilisateur } from '../utilisateur';
import { documentVente } from './document-vente';
import { moyenPaiementEnum, motifBulletinPaiementEnum, natureImputationEnum, paiementSourceEnum } from './enums';

/** Encaissement réel (MD-50). Immuable (MD-52) — voir paiement_verrouiller côté SQL. */
export const paiement = pgTable(
  'paiement',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    siteId: uuid('site_id').notNull(),

    dateValeur: date('date_valeur').notNull(),
    moyen: moyenPaiementEnum('moyen').notNull(),
    /** Signé : négatif = remboursement / contre-passation (MD-50). */
    montantCentimes: bigint('montant_centimes', { mode: 'bigint' }).notNull(),
    /** `paiement_devise_chk` (migration 0010) restreint exactement à CHF/EUR — même ensemble que
     * `DEVISES_FACTURATION` (`@dfa/shared`), d'où le type littéral dérivé ici. */
    devise: char('devise', { length: 3 }).notNull().default('CHF').$type<DeviseFacturation>(),
    payeurClientId: uuid('payeur_client_id'),
    payeurLibelle: text('payeur_libelle').notNull(),

    /** Phase 2 (camt.054) — colonnes posées maintenant, §5.5 du modèle documentaire. */
    referenceQr: text('reference_qr'),
    identifiantTransactionBanque: text('identifiant_transaction_banque'),
    source: paiementSourceEnum('source').notNull().default('manuel'),
    contrePasseId: uuid('contre_passe_id'),

    exporteLe: timestamp('exporte_le', { withTimezone: true, mode: 'date' }),
    exportId: uuid('export_id'),

    creeParId: uuid('cree_par_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('paiement_tenant_id_uk').on(t.tenantId, t.id),
    unique('paiement_transaction_banque_uk').on(t.tenantId, t.identifiantTransactionBanque),
    foreignKey({
      name: 'paiement_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'paiement_fk_payeur',
      columns: [t.tenantId, t.payeurClientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'paiement_fk_contre_passe',
      columns: [t.tenantId, t.contrePasseId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'paiement_fk_cree_par',
      columns: [t.tenantId, t.creeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('paiement_payeur_idx').on(t.tenantId, t.payeurClientId, t.dateValeur),
    index('paiement_date_idx').on(t.tenantId, t.dateValeur),
    check('paiement_montant_non_nul_chk', sql`${t.montantCentimes} <> 0`),
  ],
);

/**
 * Ce que le paiement solde (MD-50). MD-51 : deux invariants agrégés vérifiés par trigger AFTER
 * INSERT (voir la migration), pas exprimables en CHECK — ils portent sur des SOMMES.
 * Append-only par privilège : `dfa_app` a SELECT/INSERT/UPDATE (0019), mais `imputation_
 * paiement_verrouiller` (trigger BEFORE UPDATE) n'autorise que `exporteLe`/`exportId` à changer
 * après création — même doctrine que `paiement` (`paiement_verrouiller`). `exporteLe`/`exportId`
 * (0019, MD-91) : granularité réelle du suivi d'export comptable, voir la migration.
 */
export const imputationPaiement = pgTable(
  'imputation_paiement',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    paiementId: uuid('paiement_id').notNull(),
    documentId: uuid('document_id').notNull(),
    montantCentimes: bigint('montant_centimes', { mode: 'bigint' }).notNull(),
    nature: natureImputationEnum('nature').notNull(),
    imputeLe: timestamp('impute_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    imputeParId: uuid('impute_par_id'),

    exporteLe: timestamp('exporte_le', { withTimezone: true, mode: 'date' }),
    exportId: uuid('export_id'),

    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('imputation_paiement_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'imputation_paiement_fk_paiement',
      columns: [t.tenantId, t.paiementId],
      foreignColumns: [paiement.tenantId, paiement.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'imputation_paiement_fk_document',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'imputation_paiement_fk_impute_par',
      columns: [t.tenantId, t.imputeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('imputation_paiement_document_idx').on(t.tenantId, t.documentId),
    index('imputation_paiement_paiement_idx').on(t.tenantId, t.paiementId),
    check('imputation_paiement_montant_non_nul_chk', sql`${t.montantCentimes} <> 0`),
  ],
);

/** Bulletin de solde/relance, distinct de la facture (MD-82). Append-only. */
export const bulletinPaiement = pgTable(
  'bulletin_paiement',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    documentId: uuid('document_id').notNull(),
    motif: motifBulletinPaiementEnum('motif').notNull(),
    qrReference: text('qr_reference').notNull(),
    qrMontantCentimes: bigint('qr_montant_centimes', { mode: 'bigint' }),
    qrPayload: text('qr_payload').notNull(),
    qrPayloadSha256: text('qr_payload_sha256').notNull(),
    emisLe: timestamp('emis_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    emisParId: uuid('emis_par_id'),

    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('bulletin_paiement_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'bulletin_paiement_fk_document',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'bulletin_paiement_fk_emis_par',
      columns: [t.tenantId, t.emisParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('bulletin_paiement_document_idx').on(t.tenantId, t.documentId),
    index('bulletin_paiement_reference_idx').on(t.tenantId, t.qrReference),
  ],
);

export type LignePaiement = typeof paiement.$inferSelect;
export type LigneImputationPaiement = typeof imputationPaiement.$inferSelect;
export type LigneBulletinPaiement = typeof bulletinPaiement.$inferSelect;
