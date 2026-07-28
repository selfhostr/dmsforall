/**
 * `cle_idempotence` — rejeu sans double effet des créations sensibles (contrat §2.9).
 *
 * `unique (tenant_id, methode, chemin, cle)` est la cible EXACTE du
 * `on conflict (tenant_id, methode, chemin, cle) do nothing` de `ServiceIdempotenceImpl`
 * (`common/idempotence/service-idempotence.ts`) : ne pas renommer ces colonnes sans coordonner
 * les deux fichiers.
 */

import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { bytea, colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';

export const cleIdempotence = pgTable(
  'cle_idempotence',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    methode: text('methode').notNull(),
    chemin: text('chemin').notNull(),
    cle: text('cle').notNull(),
    empreinteRequete: bytea('empreinte_requete').notNull(),
    statut: text('statut').notNull().default('en_cours'),
    statutHttp: smallint('statut_http'),
    reponse: jsonb('reponse'),
    expireLe: timestamp('expire_le', { withTimezone: true, mode: 'date' }).notNull(),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('cle_idempotence_tenant_id_uk').on(t.tenantId, t.id),
    unique('cle_idempotence_uk').on(t.tenantId, t.methode, t.chemin, t.cle),
    check('cle_idempotence_statut_chk', sql`${t.statut} in ('en_cours', 'termine')`),
    check(
      'cle_idempotence_statut_http_chk',
      sql`${t.statutHttp} is null or ${t.statutHttp} between 100 and 599`,
    ),
  ],
);

export type LigneCleIdempotence = typeof cleIdempotence.$inferSelect;
export type NouvelleCleIdempotence = typeof cleIdempotence.$inferInsert;
