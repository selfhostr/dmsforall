/**
 * Chaîne documentaire — `document_vente`, `ligne_document`, `document_vente_tva`.
 * Détail des règles, triggers et de l'arithmétique TTC (§0.2) : migrations/0010_facturation.sql
 * §7→§9.
 *
 * Non modélisés ici (posés en SQL brut, non exprimables via `drizzle-kit` pg-core) :
 *   - `numero_normalise` et `qr_iban_est_qr_iban` : colonnes GENERATED ALWAYS ... STORED ;
 *   - la quasi-totalité des CHECK et index uniques partiels (chaîne MD-03, avoir RF-11→18, QR
 *     MD-74, etc.) — le SQL de la migration fait foi, `drizzle-kit generate` sert de contrôle de
 *     dérive, pas de source de vérité (voir schema/index.ts).
 */

import type { DeviseFacturation } from '@dfa/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  colonneCreeLe,
  colonnesHorodatage,
  colonneId,
  colonneTenantId,
} from '../colonnes-communes';
import { langueEnum } from '../enums';
import { site } from '../site';
import { tenant } from '../tenant';
import { client } from '../atelier/client';
import { ligneOr, ordreReparation } from '../atelier/ordre-reparation';
import { vehicule } from '../atelier/vehicule';
import {
  modeCalculTvaEnum,
  motifAvoirEnum,
  natureFactureEnum,
  origineDocumentEnum,
  porteeAvoirEnum,
  regimeTvaEnum,
  statutDocumentVenteEnum,
  statutReglementDocumentEnum,
  typeDocumentVenteEnum,
  typeLigneDocumentEnum,
  typeReferenceQrEnum,
} from './enums';

/** Le cœur de la chaîne devis/bon_commande/facture/avoir (RF-1→RF-19, MD-01→MD-46). */
export const documentVente = pgTable(
  'document_vente',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),

    typeDocument: typeDocumentVenteEnum('type_document').notNull(),
    natureFacture: natureFactureEnum('nature_facture').notNull().default('ordinaire'),
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    statut: statutDocumentVenteEnum('statut').notNull().default('brouillon'),
    statutReglement: statutReglementDocumentEnum('statut_reglement').notNull().default('non_regle'),

    numeroSequence: integer('numero_sequence'),
    numero: text('numero'),
    numeroOrigine: text('numero_origine'),
    // numero_normalise : colonne générée, non modélisée (voir en-tête).
    exercice: smallint('exercice'),

    dateDocument: date('date_document'),
    datePrestationDebut: date('date_prestation_debut'),
    datePrestationFin: date('date_prestation_fin'),
    dateEcheance: date('date_echeance'),
    emisLe: timestamp('emis_le', { withTimezone: true, mode: 'date' }),

    clientId: uuid('client_id').notNull(),
    vehiculeId: uuid('vehicule_id'),
    ordreReparationId: uuid('ordre_reparation_id'),
    /** Accroche étape 4 (MD-70) : vide tant que la vente de véhicule n'existe pas, sans FK. */
    dossierVenteId: uuid('dossier_vente_id'),
    clientDesignationFigee: text('client_designation_figee').notNull(),
    clientIdeFige: text('client_ide_fige'),
    langueFigee: langueEnum('langue_figee').notNull(),
    adresseFacturationFigee: jsonb('adresse_facturation_figee').notNull(),
    conditionsPaiementFigees: jsonb('conditions_paiement_figees').notNull().default({}),

    documentSourceId: uuid('document_source_id'),
    factureAnnuleeId: uuid('facture_annulee_id'),
    /** RF-32 : posé sur la FACTURE annulée — sens inverse de `factureAnnuleeId`. */
    annuleParAvoirId: uuid('annule_par_avoir_id'),
    remplaceId: uuid('remplace_id'),

    porteeAvoir: porteeAvoirEnum('portee_avoir'),
    motifAvoir: motifAvoirEnum('motif_avoir'),
    motifAvoirLibre: text('motif_avoir_libre'),

    tvaNonVentilee: boolean('tva_non_ventilee').notNull().default(false),
    tauxTvaPourmille: smallint('taux_tva_pourmille'),
    mentionTvaInterdite: boolean('mention_tva_interdite').notNull().default(false),

    totalHtCentimes: bigint('total_ht_centimes', { mode: 'bigint' }).notNull().default(0n),
    totalTvaCentimes: bigint('total_tva_centimes', { mode: 'bigint' }).notNull().default(0n),
    ecartRepriseCentimes: bigint('ecart_reprise_centimes', { mode: 'bigint' })
      .notNull()
      .default(0n),
    totalTtcCentimes: bigint('total_ttc_centimes', { mode: 'bigint' }).notNull().default(0n),
    remiseGlobalePourmille: smallint('remise_globale_pourmille'),
    remiseGlobaleSaisieCentimes: bigint('remise_globale_saisie_centimes', { mode: 'bigint' }),
    montantRegleCentimes: bigint('montant_regle_centimes', { mode: 'bigint' })
      .notNull()
      .default(0n),
    soldeCentimes: bigint('solde_centimes', { mode: 'bigint' }).notNull().default(0n),

    /** `document_vente_devise_chk` (migration 0015) : borné à CHF/EUR — même ensemble que
     * `paiement_devise_chk` et `document_vente_qr_devise_chk`, d'où le type littéral dérivé ici.
     * Avant 0015, cette colonne n'était contrainte qu'en FORME (`^[A-Z]{3}$`) : voir 0015 pour
     * l'historique de l'incohérence corrigée. */
    devise: char('devise', { length: 3 }).notNull().default('CHF').$type<DeviseFacturation>(),

    qrIban: text('qr_iban'),
    // qr_iban_est_qr_iban : colonne générée, non modélisée (voir en-tête).
    creancierNom: text('creancier_nom'),
    creancierRue: text('creancier_rue'),
    creancierNumero: text('creancier_numero'),
    creancierNpa: text('creancier_npa'),
    creancierLocalite: text('creancier_localite'),
    creancierPays: char('creancier_pays', { length: 2 }),
    typeReferenceQr: typeReferenceQrEnum('type_reference_qr'),
    qrReference: text('qr_reference'),
    qrMontantCentimes: bigint('qr_montant_centimes', { mode: 'bigint' }),
    /** `document_vente_qr_devise_chk` (migration 0010) : nul ou strictement CHF/EUR — même
     * ensemble que `DEVISES_FACTURATION`, d'où le type littéral dérivé ici. */
    qrDevise: char('qr_devise', { length: 3 }).$type<DeviseFacturation>(),
    qrLangue: langueEnum('qr_langue'),
    qrDebiteurPresent: boolean('qr_debiteur_present').notNull().default(false),
    qrPayload: text('qr_payload'),
    qrPayloadSha256: text('qr_payload_sha256'),

    pdfCle: text('pdf_cle'),
    pdfSha256: text('pdf_sha256'),

    exporteLe: timestamp('exporte_le', { withTimezone: true, mode: 'date' }),
    exportId: uuid('export_id'),

    relanceNiveau: smallint('relance_niveau').notNull().default(0),
    relanceLe: timestamp('relance_le', { withTimezone: true, mode: 'date' }),
    contentieux: boolean('contentieux').notNull().default(false),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('document_vente_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'document_vente_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_source',
      columns: [t.tenantId, t.documentSourceId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_facture_annulee',
      columns: [t.tenantId, t.factureAnnuleeId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_annule_par_avoir',
      columns: [t.tenantId, t.annuleParAvoirId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'document_vente_fk_remplace',
      columns: [t.tenantId, t.remplaceId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    index('document_vente_client_idx').on(t.tenantId, t.clientId, t.dateDocument),
    index('document_vente_or_idx').on(t.tenantId, t.ordreReparationId),
    index('document_vente_pagination_idx').on(t.tenantId, t.creeLe, t.id),
    // Index uniques partiels (numéro, séquence, numéro d'origine, référence QR, source, remplace)
    // et l'ensemble des CHECK sont posés en SQL brut (migration §7) — expressions non modélisables
    // proprement via pg-core (WHERE partiel sur plusieurs colonnes générées/nullables).
  ],
);

/**
 * Ligne d'un document de vente. §0.2 : `prixUnitaireCentimes` est un montant TTC,
 * `htCentimes` est le résidu `ttc − tva` (jamais recalculé séparément) — voir la migration pour
 * le détail de l'arrondi.
 */
export const ligneDocument = pgTable(
  'ligne_document',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    documentId: uuid('document_id').notNull(),
    numeroOrdre: smallint('numero_ordre').notNull(),

    typeLigne: typeLigneDocumentEnum('type_ligne').notNull(),
    designation: text('designation').notNull(),
    referenceTexte: text('reference_texte'),

    ligneOrId: uuid('ligne_or_id'),
    documentAcompteId: uuid('document_acompte_id'),
    categorieComptable: text('categorie_comptable'),

    modeCalculTva: modeCalculTvaEnum('mode_calcul_tva').notNull().default('ttc'),
    regimeTva: regimeTvaEnum('regime_tva').notNull().default('normal'),
    tauxTvaPourmille: smallint('taux_tva_pourmille').notNull(),
    datePrestation: date('date_prestation').notNull(),

    quantiteMillieme: integer('quantite_millieme').notNull().default(1000),
    prixUnitaireCentimes: integer('prix_unitaire_centimes').notNull().default(0),

    remisePourmille: smallint('remise_pourmille'),
    remiseMontantCentimes: integer('remise_montant_centimes'),
    remiseGlobaleRepartieCentimes: integer('remise_globale_repartie_centimes').notNull().default(0),

    baseCentimes: integer('base_centimes').notNull().default(0),
    htCentimes: integer('ht_centimes').notNull(),
    tvaCentimes: integer('tva_centimes').notNull(),
    ttcCentimes: integer('ttc_centimes').notNull(),

    montantValoriseCentimes: integer('montant_valorise_centimes'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('ligne_document_tenant_id_uk').on(t.tenantId, t.id),
    unique('ligne_document_tenant_doc_ordre_uk').on(t.tenantId, t.documentId, t.numeroOrdre),
    foreignKey({
      name: 'ligne_document_fk_document',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ligne_document_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ligne_document_fk_document_acompte',
      columns: [t.tenantId, t.documentAcompteId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    index('ligne_document_document_idx').on(t.tenantId, t.documentId, t.numeroOrdre),
    index('ligne_document_or_idx').on(t.tenantId, t.ligneOrId),
    // Δ-RF40 (§0.2) : type PG complet, restreint à 'ttc' pour le lot pilote.
    check('ligne_document_mode_ttc_lot_pilote_chk', sql`${t.modeCalculTva} = 'ttc'`),
    check(
      'ligne_document_montant_coherent_chk',
      sql`${t.ttcCentimes} = ${t.htCentimes} + ${t.tvaCentimes}`,
    ),
  ],
);

/** Récapitulatif TVA par (régime, taux), figé à l'émission (MD-45). Append-only. */
export const documentVenteTva = pgTable(
  'document_vente_tva',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    documentId: uuid('document_id').notNull(),
    regimeTva: regimeTvaEnum('regime_tva').notNull(),
    tauxTvaPourmille: smallint('taux_tva_pourmille').notNull(),
    baseCentimes: integer('base_centimes').notNull(),
    tvaCentimes: integer('tva_centimes').notNull(),

    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('document_vente_tva_tenant_id_uk').on(t.tenantId, t.id),
    unique('document_vente_tva_tenant_doc_regime_taux_uk').on(
      t.tenantId,
      t.documentId,
      t.regimeTva,
      t.tauxTvaPourmille,
    ),
    foreignKey({
      name: 'document_vente_tva_fk_document',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documentVente.tenantId, documentVente.id],
    }).onDelete('restrict'),
    index('document_vente_tva_document_idx').on(t.tenantId, t.documentId),
  ],
);

export type LigneDocumentVente = typeof documentVente.$inferSelect;
export type LigneLigneDocument = typeof ligneDocument.$inferSelect;
export type LigneDocumentVenteTva = typeof documentVenteTva.$inferSelect;
