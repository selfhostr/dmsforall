/**
 * Export fiduciaire — `mapping_compte`, `mapping_code_tva`, `correspondance_externe`,
 * `export_comptable`. Détail : migrations/0010_facturation.sql §13.
 *
 * L'EXCLUDE GiST de `mapping_compte` (aucune période active ne chevauche une autre pour un même
 * (usage, categorie)) est posée en SQL brut — même patron que `taux_horaire`.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
import {
  cibleExportEnum,
  modeAgregationExportEnum,
  regimeTvaEnum,
  statutExportComptableEnum,
  usageMappingCompteEnum,
} from './enums';

/** Plan comptable du tenant (MD-86), versionné par dates. RF-112 : jamais réécrit, seulement clos. */
export const mappingCompte = pgTable(
  'mapping_compte',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    usage: usageMappingCompteEnum('usage').notNull(),
    categorie: text('categorie').notNull(),
    compte: text('compte').notNull(),
    libelle: text('libelle'),
    actifDu: date('actif_du').notNull(),
    actifAu: date('actif_au'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('mapping_compte_tenant_id_uk').on(t.tenantId, t.id),
    check('mapping_compte_periode_chk', sql`${t.actifAu} is null or ${t.actifAu} > ${t.actifDu}`),
    index('mapping_compte_usage_idx').on(t.tenantId, t.usage, t.categorie),
  ],
);

/** Codes TVA par cible d'export (MD-86), indexés sur (cible, régime, taux) — voir CF-09. */
export const mappingCodeTva = pgTable(
  'mapping_code_tva',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    cible: cibleExportEnum('cible').notNull(),
    regimeTva: regimeTvaEnum('regime_tva').notNull(),
    tauxPourmille: integer('taux_pourmille').notNull(),
    codeExterne: text('code_externe').notNull(),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('mapping_code_tva_tenant_id_uk').on(t.tenantId, t.id),
    unique('mapping_code_tva_tenant_uk').on(t.tenantId, t.cible, t.regimeTva, t.tauxPourmille),
  ],
);

/** Pendant de correspondance_reprise (MD-87), indexée PAR CIBLE — RF-112. */
export const correspondanceExterne = pgTable(
  'correspondance_externe',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    cible: cibleExportEnum('cible').notNull(),
    entite: text('entite').notNull(),
    dfaId: uuid('dfa_id').notNull(),
    externeId: text('externe_id').notNull(),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('correspondance_externe_tenant_id_uk').on(t.tenantId, t.id),
    unique('correspondance_externe_tenant_uk').on(t.tenantId, t.cible, t.entite, t.dfaId),
  ],
);

/** Lot d'export fiduciaire (MD-91), conservé à vie avec son empreinte (RF-111). */
export const exportComptable = pgTable(
  'export_comptable',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    cible: cibleExportEnum('cible').notNull(),
    mode: modeAgregationExportEnum('mode').notNull().default('detaille'),
    periodeDebut: date('periode_debut').notNull(),
    periodeFin: date('periode_fin').notNull(),

    genereLe: timestamp('genere_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    genereParId: uuid('genere_par_id'),

    nbEcritures: integer('nb_ecritures').notNull(),
    totalDebitCentimes: bigint('total_debit_centimes', { mode: 'bigint' }).notNull(),
    totalCreditCentimes: bigint('total_credit_centimes', { mode: 'bigint' }).notNull(),
    empreinteSha256: text('empreinte_sha256').notNull(),
    statut: statutExportComptableEnum('statut').notNull().default('genere'),
    reponseCible: jsonb('reponse_cible'),

    // Synthèse (migration 0084) — NULL pour les lots antérieurs.
    nbFactures: integer('nb_factures'),
    nbAvoirs: integer('nb_avoirs'),
    nbEncaissements: integer('nb_encaissements'),
    totalHtCentimes: bigint('total_ht_centimes', { mode: 'bigint' }),
    totalTvaCentimes: bigint('total_tva_centimes', { mode: 'bigint' }),
    totalTtcCentimes: bigint('total_ttc_centimes', { mode: 'bigint' }),
    facturePremier: text('facture_premier'),
    factureDernier: text('facture_dernier'),
    avoirPremier: text('avoir_premier'),
    avoirDernier: text('avoir_dernier'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('export_comptable_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'export_comptable_fk_genere_par',
      columns: [t.tenantId, t.genereParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('export_comptable_periode_idx').on(t.tenantId, t.cible, t.periodeDebut),
    check('export_comptable_periode_chk', sql`${t.periodeFin} >= ${t.periodeDebut}`),
    check(
      'export_comptable_equilibre_chk',
      sql`${t.totalDebitCentimes} = ${t.totalCreditCentimes}`,
    ),
  ],
);

/** Fichier produit par un lot (migration 0084) — gzip, immuable, hors audit (voir la migration). */
export const exportComptableFichier = pgTable(
  'export_comptable_fichier',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    exportId: uuid('export_id').notNull(),
    nomFichier: text('nom_fichier').notNull(),
    typeMime: text('type_mime').notNull(),
    tailleOctets: integer('taille_octets').notNull(),
    contenuGz: bytea('contenu_gz').notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('export_comptable_fichier_export_uk').on(t.tenantId, t.exportId),
    foreignKey({
      name: 'export_comptable_fichier_fk_export',
      columns: [t.tenantId, t.exportId],
      foreignColumns: [exportComptable.tenantId, exportComptable.id],
    }).onDelete('restrict'),
  ],
);

export type LigneMappingCompte = typeof mappingCompte.$inferSelect;
export type LigneMappingCodeTva = typeof mappingCodeTva.$inferSelect;
export type LigneCorrespondanceExterne = typeof correspondanceExterne.$inferSelect;
export type LigneExportComptable = typeof exportComptable.$inferSelect;
