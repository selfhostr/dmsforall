/**
 * Lecture automatique des factures fournisseurs — `facture_fournisseur_document`,
 * `facture_fournisseur`, `facture_fournisseur_ligne`, `facture_fournisseur_audit`.
 * Détail des règles, chaîne de lecture (QR → texte PDF → OCR) et rapprochement :
 * `apps/api/src/pieces/factures-fournisseur/`, migration `0059_factures_fournisseur.sql`.
 *
 * QUATRE tables, PAS UNE : le binaire (`facture_fournisseur_document`) est SÉPARÉ de l'en-tête
 * (`facture_fournisseur`) pour qu'une LISTE de factures ne charge jamais l'octet du PDF — voir
 * `service-facture-fournisseur.ts`, qui ne sélectionne jamais `contenu` hors de
 * `GET /factures-fournisseur/{id}/document`. `facture_fournisseur_audit` est APPEND-ONLY, même
 * patron que `vehicule_ocr_scan_journal` (0058) : qui a déposé/validé/rejeté, avant/après, jamais
 * de piste générique `audit_atelier` (propriété du domaine atelier, `entite_auditee` n'énumère
 * aucune entité pièces — étendre cet enum est hors périmètre d'écriture de ce lot).
 */

import { sql } from 'drizzle-orm';
import {
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

import { bytea, colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
import { article } from './article';
import { commandeFournisseur, commandeFournisseurLigne } from './commande-fournisseur';
import {
  actionAuditFactureFournisseurEnum,
  origineDonneeFactureEnum,
  statutFactureFournisseurEnum,
} from './enums';
import { fournisseur } from './fournisseur';

/**
 * Binaire déposé. Immuable une fois écrit : `dfa_app` n'a ni UPDATE ni DELETE (migration §5) — la
 * pièce comptable ne change jamais après coup, seule l'interprétation qu'en fait
 * `facture_fournisseur` évolue (rapprochement, validation).
 */
export const factureFournisseurDocument = pgTable(
  'facture_fournisseur_document',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    contenu: bytea('contenu').notNull(),
    typeMime: text('type_mime').notNull(),
    tailleOctets: integer('taille_octets').notNull(),
    /** SHA-256, 32 octets bruts — sert à refuser un second dépôt du MÊME fichier
     *  (`facture_fournisseur_document_tenant_empreinte_uk`). */
    empreinteSha256: bytea('empreinte_sha256').notNull(),
    deposeParId: uuid('depose_par_id').notNull(),
    deposeLe: timestamp('depose_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('facture_fournisseur_document_tenant_id_uk').on(t.tenantId, t.id),
    unique('facture_fournisseur_document_tenant_empreinte_uk').on(t.tenantId, t.empreinteSha256),
    foreignKey({
      name: 'facture_fournisseur_document_fk_depose_par',
      columns: [t.tenantId, t.deposeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    // v1 : PDF uniquement (voir la migration 0059, en-tête) — restriction du lot, pas du stockage.
    check('facture_fournisseur_document_type_mime_chk', sql`${t.typeMime} = 'application/pdf'`),
    check('facture_fournisseur_document_taille_chk', sql`${t.tailleOctets} > 0`),
  ],
);

/**
 * En-tête. `contenu` du document n'apparaît JAMAIS ici — voir l'en-tête de fichier.
 * `champsOrigine` (JSONB) : la provenance est un attribut RÉELLEMENT variable (dépend document par
 * document de ce que la chaîne a trouvé et par quel moyen) — c'est l'usage que CONTRIBUTING.md réserve au
 * JSONB, pas un contournement de modélisation.
 */
export const factureFournisseur = pgTable(
  'facture_fournisseur',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id').notNull(),
    fournisseurId: uuid('fournisseur_id'),
    commandeFournisseurId: uuid('commande_fournisseur_id'),
    statut: statutFactureFournisseurEnum('statut').notNull().default('deposee'),
    ibanCreancier: text('iban_creancier'),
    nomCreancier: text('nom_creancier'),
    numeroFacture: text('numero_facture'),
    dateFacture: date('date_facture'),
    montantTotalCentimes: integer('montant_total_centimes'),
    devise: text('devise').notNull().default('CHF'),
    referencePaiement: text('reference_paiement'),
    champsOrigine: jsonb('champs_origine').notNull().default({}),
    deposeParId: uuid('depose_par_id').notNull(),
    deposeLe: timestamp('depose_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    valideParId: uuid('valide_par_id'),
    valideLe: timestamp('valide_le', { withTimezone: true, mode: 'date' }),
    motifRejet: text('motif_rejet'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('facture_fournisseur_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'facture_fournisseur_fk_document',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [factureFournisseurDocument.tenantId, factureFournisseurDocument.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_fk_fournisseur',
      columns: [t.tenantId, t.fournisseurId],
      foreignColumns: [fournisseur.tenantId, fournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_fk_commande',
      columns: [t.tenantId, t.commandeFournisseurId],
      foreignColumns: [commandeFournisseur.tenantId, commandeFournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_fk_depose_par',
      columns: [t.tenantId, t.deposeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_fk_valide_par',
      columns: [t.tenantId, t.valideParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('facture_fournisseur_devise_chk', sql`${t.devise} in ('CHF', 'EUR')`),
    check(
      'facture_fournisseur_montant_chk',
      sql`${t.montantTotalCentimes} is null or ${t.montantTotalCentimes} >= 0`,
    ),
    check(
      'facture_fournisseur_rejet_motif_chk',
      sql`${t.statut} <> 'rejetee' or ${t.motifRejet} is not null`,
    ),
    check(
      'facture_fournisseur_validation_coherente_chk',
      sql`${t.statut} <> 'validee' or (${t.valideParId} is not null and ${t.valideLe} is not null)`,
    ),
    index('facture_fournisseur_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    index('facture_fournisseur_statut_idx').on(t.tenantId, t.statut),
    index('facture_fournisseur_fournisseur_idx').on(t.tenantId, t.fournisseurId),
    index('facture_fournisseur_commande_idx').on(t.tenantId, t.commandeFournisseurId),
  ],
);

export const factureFournisseurLigne = pgTable(
  'facture_fournisseur_ligne',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    factureFournisseurId: uuid('facture_fournisseur_id').notNull(),
    numeroOrdre: smallint('numero_ordre').notNull(),
    referenceArticle: text('reference_article'),
    designation: text('designation'),
    quantiteMillieme: integer('quantite_millieme').notNull(),
    prixUnitaireCentimes: integer('prix_unitaire_centimes'),
    totalLigneCentimes: integer('total_ligne_centimes'),
    origine: origineDonneeFactureEnum('origine').notNull(),
    articleId: uuid('article_id'),
    commandeFournisseurLigneId: uuid('commande_fournisseur_ligne_id'),
    /** Écarts PRÉ-CALCULÉS à l'écriture (jamais recalculés à la lecture) — voir
     *  `service-rapprochement.ts`. `null` : pas de ligne de commande rapprochée, rien à comparer. */
    ecartPrixUnitaireCentimes: integer('ecart_prix_unitaire_centimes'),
    ecartQuantiteMillieme: integer('ecart_quantite_millieme'),
    ecartTotalCentimes: integer('ecart_total_centimes'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('facture_fournisseur_ligne_tenant_id_uk').on(t.tenantId, t.id),
    unique('facture_fournisseur_ligne_tenant_facture_ordre_uk').on(
      t.tenantId,
      t.factureFournisseurId,
      t.numeroOrdre,
    ),
    foreignKey({
      name: 'facture_fournisseur_ligne_fk_facture',
      columns: [t.tenantId, t.factureFournisseurId],
      foreignColumns: [factureFournisseur.tenantId, factureFournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_ligne_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_ligne_fk_commande_ligne',
      columns: [t.tenantId, t.commandeFournisseurLigneId],
      foreignColumns: [commandeFournisseurLigne.tenantId, commandeFournisseurLigne.id],
    }).onDelete('restrict'),
    check('facture_fournisseur_ligne_quantite_chk', sql`${t.quantiteMillieme} > 0`),
    check(
      'facture_fournisseur_ligne_prix_chk',
      sql`${t.prixUnitaireCentimes} is null or ${t.prixUnitaireCentimes} >= 0`,
    ),
    check(
      'facture_fournisseur_ligne_total_chk',
      sql`${t.totalLigneCentimes} is null or ${t.totalLigneCentimes} >= 0`,
    ),
    index('facture_fournisseur_ligne_facture_idx').on(
      t.tenantId,
      t.factureFournisseurId,
      t.numeroOrdre,
    ),
    index('facture_fournisseur_ligne_commande_ligne_idx')
      .on(t.tenantId, t.commandeFournisseurLigneId)
      .where(sql`${t.commandeFournisseurLigneId} is not null`),
  ],
);

/** Append-only — voir l'en-tête de fichier. */
export const factureFournisseurAudit = pgTable(
  'facture_fournisseur_audit',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    factureFournisseurId: uuid('facture_fournisseur_id').notNull(),
    utilisateurId: uuid('utilisateur_id').notNull(),
    action: actionAuditFactureFournisseurEnum('action').notNull(),
    valeurAvant: jsonb('valeur_avant'),
    valeurApres: jsonb('valeur_apres'),
    creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'facture_fournisseur_audit_fk_facture',
      columns: [t.tenantId, t.factureFournisseurId],
      foreignColumns: [factureFournisseur.tenantId, factureFournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'facture_fournisseur_audit_fk_utilisateur',
      columns: [t.tenantId, t.utilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('facture_fournisseur_audit_facture_idx').on(t.tenantId, t.factureFournisseurId, t.creeLe),
  ],
);

export type LigneFactureFournisseurDocument = typeof factureFournisseurDocument.$inferSelect;
export type NouvelleFactureFournisseurDocument = typeof factureFournisseurDocument.$inferInsert;
export type LigneFactureFournisseur = typeof factureFournisseur.$inferSelect;
export type NouvelleFactureFournisseur = typeof factureFournisseur.$inferInsert;
export type LigneFactureFournisseurLigne = typeof factureFournisseurLigne.$inferSelect;
export type NouvelleFactureFournisseurLigne = typeof factureFournisseurLigne.$inferInsert;
export type LigneFactureFournisseurAudit = typeof factureFournisseurAudit.$inferSelect;
export type NouvelleFactureFournisseurAudit = typeof factureFournisseurAudit.$inferInsert;
