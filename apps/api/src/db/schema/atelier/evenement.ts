/**
 * `evenement_metier` — outbox transactionnelle (§1.6 du plan d'exécution du lot 1).
 *
 * Colonnes alignées sur ce que `ServiceEvenementsImpl` (`common/evenements/service-evenements.ts`)
 * écrit déjà : `ressource_type` / `ressource_numero` / `donnees` (dérivés du contrat gelé
 * `EnveloppeEvenementMetier`). Toujours écrite dans la transaction REÇUE par le service, jamais
 * dans une transaction propre — aucune contrainte différée ici ne doit changer cela.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { typeEvenementMetierEnum } from './enums';

export const evenementMetier = pgTable(
  'evenement_metier',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id'),
    type: typeEvenementMetierEnum('type').notNull(),
    ressourceType: text('ressource_type').notNull(),
    ressourceId: uuid('ressource_id').notNull(),
    ressourceNumero: text('ressource_numero'),
    survenuLe: timestamp('survenu_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    versionSchema: smallint('version_schema').notNull().default(1),
    donnees: jsonb('donnees').notNull(),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('evenement_metier_tenant_id_uk').on(t.tenantId, t.id),
    index('evenement_metier_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    index('evenement_metier_ressource_idx').on(
      t.tenantId,
      t.ressourceType,
      t.ressourceId,
      t.survenuLe.desc(),
    ),
    check('evenement_metier_version_schema_chk', sql`${t.versionSchema} > 0`),
  ],
);

export type LigneEvenementMetier = typeof evenementMetier.$inferSelect;
export type NouvelEvenementMetier = typeof evenementMetier.$inferInsert;
