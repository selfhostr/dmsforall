/**
 * Module ventes — `dossier_vente_document_requis`. RV-35, PV-03 (check-list paramétrable, pas
 * encore de table de paramétrage tenant pour ce domaine — voir
 * `packages/shared/src/contrats/ventes/index.ts`, NOTE DE PÉRIMÈTRE). Contrat gelé (partiel) :
 * `packages/shared/src/contrats/ventes/dossier-vente.ts::DocumentRequisDossierVente`,
 * `schemaMarquerDocumentRequis`.
 * Détail : migrations/0032_ventes.sql.
 */

import { boolean, check, foreignKey, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { dossierVente } from './dossier-vente';

/**
 * Un item de la check-list de livraison par dossier (RV-35, RV-52 : « la livraison suppose que
 * TOUS les éléments suivants soient réunis »). `code`/`libelle` sont COPIÉS ici au moment où
 * l'item est attaché au dossier (contrat : `code` n'est pas un enum fermé, la liste exacte est
 * `[À VALIDER, QV-07/PV-03]`, paramétrable par tenant) — une évolution ultérieure du référentiel
 * tenant ne réécrit jamais un dossier déjà en cours, même doctrine que
 * `document_vente.client_designation_figee` (figé à l'émission, pas une relecture dynamique de la
 * fiche client).
 */
export const dossierVenteDocumentRequis = pgTable(
  'dossier_vente_document_requis',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    dossierVenteId: uuid('dossier_vente_id').notNull(),
    code: text('code').notNull(),
    libelle: text('libelle').notNull(),
    fourni: boolean('fourni').notNull().default(false),
    fourniLe: timestamp('fourni_le', { withTimezone: true, mode: 'date' }),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('dossier_vente_document_requis_tenant_id_uk').on(t.tenantId, t.id),
    unique('dossier_vente_document_requis_tenant_dossier_code_uk').on(
      t.tenantId,
      t.dossierVenteId,
      t.code,
    ),
    foreignKey({
      name: 'dossier_vente_document_requis_fk_dossier',
      columns: [t.tenantId, t.dossierVenteId],
      foreignColumns: [dossierVente.tenantId, dossierVente.id],
    }).onDelete('restrict'),
    check('dossier_vente_document_requis_code_non_vide_chk', sql`length(btrim(${t.code})) > 0`),
    check(
      'dossier_vente_document_requis_libelle_non_vide_chk',
      sql`length(btrim(${t.libelle})) > 0`,
    ),
    check(
      'dossier_vente_document_requis_fourni_coherent_chk',
      sql`${t.fourni} = (${t.fourniLe} is not null)`,
    ),
  ],
);

export type LigneDossierVenteDocumentRequis = typeof dossierVenteDocumentRequis.$inferSelect;
export type NouveauDossierVenteDocumentRequis = typeof dossierVenteDocumentRequis.$inferInsert;
