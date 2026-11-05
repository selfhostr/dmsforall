/**
 * `resiliation_tenant_evenement` — piste d'audit APPEND-ONLY du cycle de sortie du garage
 * (migration 0062) : une ligne par transition de `resiliation_tenant.statut`. Répond à
 * l'exigence d'audit de l'effacement final (« quand, sur quel tenant, à la demande de qui »)
 * pour TOUTES les transitions, pas seulement la dernière — une ligne unique sur
 * `resiliation_tenant` écraserait l'historique à chaque UPDATE.
 *
 * `dfa_app` ne reçoit que `SELECT`/`INSERT` (migration 0062) : append-only, comme
 * `journal_securite`/`audit_utilisateur`.
 */

import { boolean, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonneId, colonneTenantId } from './colonnes-communes';
import { resiliationTenant } from './resiliation-tenant';
import { utilisateur } from './utilisateur';

export const resiliationTenantEvenement = pgTable(
  'resiliation_tenant_evenement',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    resiliationTenantId: uuid('resiliation_tenant_id').notNull(),

    /** NULL sur l'événement de création (`demandee`). */
    statutPrecedent: text('statut_precedent'),
    statutNouveau: text('statut_nouveau').notNull(),

    survenueLe: timestamp('survenue_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    declencheParUtilisateurId: uuid('declenche_par_utilisateur_id').references(
      () => utilisateur.id,
      { onDelete: 'restrict' },
    ),
    declencheAutomatiquement: boolean('declenche_automatiquement').notNull().default(false),
    motif: text('motif'),

    /** Pas de `modifie_le` : une ligne d'événement ne se modifie pas. */
    creeLe: colonneCreeLe(),
  },
  (t) => [
    // Rend structurellement impossible le rattachement d'un événement au dossier de résiliation
    // d'un autre tenant — même patron composite que `audit_utilisateur`.
    foreignKey({
      name: 'resiliation_tenant_evenement_fk_resiliation',
      columns: [t.tenantId, t.resiliationTenantId],
      foreignColumns: [resiliationTenant.tenantId, resiliationTenant.id],
    }).onDelete('restrict'),

    index('resiliation_tenant_evenement_resiliation_idx').on(
      t.tenantId,
      t.resiliationTenantId,
      t.survenueLe,
    ),
  ],
);

export type LigneResiliationTenantEvenement = typeof resiliationTenantEvenement.$inferSelect;
export type NouvelleResiliationTenantEvenement = typeof resiliationTenantEvenement.$inferInsert;
