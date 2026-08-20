/**
 * `resiliation_tenant` — dossier de sortie du garage d'un tenant (mandat 20.08.2026, migration
 * 0062). Au plus une ligne par tenant (`unique(tenant_id)`) : machine à états locale à cette
 * migration (`statut_resiliation_tenant`, sept valeurs, dispositif partagé
 * `transition_autorisee`/`entite_auditee` non utilisable ici — voir §A de l'en-tête de
 * `0062_cycle_vie_resiliation_tenant.sql`), jamais supprimée : c'est la preuve, y compris APRÈS
 * l'effacement des données métier, que l'export a été produit/remis et que l'effacement a eu
 * lieu.
 *
 * `demandee_par_utilisateur_id`/`remis_confirme_par_utilisateur_id`/`effacee_par_utilisateur_id`
 * référencent `utilisateur.id` (pas un exploitant plateforme) : c'est le garage lui-même, depuis
 * son propre espace, qui déclenche sa résiliation — un droit métier ordinaire (arbitrage du
 * coordinateur du 20.08.2026, voir l'en-tête de la migration).
 *
 * Les CHECK de cohérence (export_pret_chk, export_echoue_chk, remis_chk, purge_prevue_chk,
 * efface_chk) et le trigger de transition (`verifier_transition_resiliation_tenant`) restent
 * définis uniquement dans la migration : ce fichier est un typage, la migration fait foi.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { STATUTS_RESILIATION_TENANT } from '@dfa/shared';

import { colonneId, colonnesHorodatage } from './colonnes-communes';
import { tenant } from './tenant';
import { utilisateur } from './utilisateur';

/** Cycle de vie de sortie du garage. Type PG : `statut_resiliation_tenant`. */
export const statutResiliationTenantEnum = pgEnum(
  'statut_resiliation_tenant',
  STATUTS_RESILIATION_TENANT,
);

export const resiliationTenant = pgTable(
  'resiliation_tenant',
  {
    id: colonneId(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    statut: statutResiliationTenantEnum('statut').notNull().default('demandee'),

    motif: text('motif').notNull(),

    demandeeLe: timestamp('demandee_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    demandeeParUtilisateurId: uuid('demandee_par_utilisateur_id')
      .notNull()
      .references(() => utilisateur.id, { onDelete: 'restrict' }),

    exportGenereLe: timestamp('export_genere_le', { withTimezone: true, mode: 'date' }),
    /** Chemin relatif opaque du répertoire d'export — même doctrine que `document_vente.pdf_cle`. */
    exportRepertoire: text('export_repertoire'),
    exportNbTables: integer('export_nb_tables'),
    exportNbLignesTotal: bigint('export_nb_lignes_total', { mode: 'number' }),
    exportTailleOctets: bigint('export_taille_octets', { mode: 'number' }),
    exportErreur: text('export_erreur'),

    remisLe: timestamp('remis_le', { withTimezone: true, mode: 'date' }),
    remisConfirmeParUtilisateurId: uuid('remis_confirme_par_utilisateur_id').references(
      () => utilisateur.id,
      { onDelete: 'restrict' },
    ),

    retentionJours: integer('retention_jours').notNull().default(180),
    /**
     * PAS une colonne `generated` : `timestamptz + interval 'N days'` n'est pas IMMUTABLE
     * (dépend du fuseau de session) — Postgres refuse toute expression GENERATED non immutable.
     * Calculée une seule fois par `ServiceCycleVieResiliation.confirmerRemise`, jamais recalculée
     * ensuite.
     */
    purgePrevueLe: timestamp('purge_prevue_le', { withTimezone: true, mode: 'date' }),

    /**
     * Toujours NULL en pratique : l'effacement n'est jamais déclenché par une route HTTP
     * (arbitrage 20.08.2026), seulement par `OrdonnanceurPurgeAutomatiqueTenant`. Colonne
     * conservée pour l'intégrité du schéma et un usage d'exploitation hors produit.
     */
    effaceeLe: timestamp('effacee_le', { withTimezone: true, mode: 'date' }),
    effaceeParUtilisateurId: uuid('effacee_par_utilisateur_id').references(() => utilisateur.id, {
      onDelete: 'restrict',
    }),
    effacementAutomatique: boolean('effacement_automatique').notNull().default(false),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Au plus un dossier de résiliation par tenant.
    unique('resiliation_tenant_tenant_uk').on(t.tenantId),
    // Cible de la FK composite de `resiliation_tenant_evenement`.
    unique('resiliation_tenant_tenant_id_uk').on(t.tenantId, t.id),

    check('resiliation_tenant_motif_non_vide_chk', sql`length(btrim(${t.motif})) > 0`),
    check('resiliation_tenant_retention_positive_chk', sql`${t.retentionJours} > 0`),
  ],
);

export type LigneResiliationTenant = typeof resiliationTenant.$inferSelect;
export type NouvelleResiliationTenant = typeof resiliationTenant.$inferInsert;
