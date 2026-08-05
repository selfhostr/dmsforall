/**
 * `regle_relance` — configuration par tenant, une ligne par `type_relance` (§5, §4 de la spec).
 * Détail : migrations/0045_relances_socle.sql §2.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, smallint, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { canalRelanceEnum, typeRelanceEnum } from './enums';

export const regleRelance = pgTable(
  'regle_relance',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    typeRelance: typeRelanceEnum('type_relance').notNull(),
    actif: boolean('actif').notNull().default(true),
    /** Paliers en jours après l'échéance de référence (§4). `smallint[]` : un délai ne dépasse
     *  jamais l'échelle de quelques mois, `smallint` suffit largement et documente l'intention
     *  (jamais une durée absolue en secondes ou millisecondes). */
    delaisJours: smallint('delais_jours')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    /** Sous-ensemble de canaux — le TYPE `canal_relance` restreint déjà le domaine des éléments,
     *  aucune CHECK de sous-ensemble supplémentaire n'est nécessaire (contrairement à un `text[]`
     *  qu'il faudrait borner soi-même). */
    canaux: canalRelanceEnum('canaux')
      .array()
      .notNull()
      .default(sql`'{}'::canal_relance[]`),
    /** Référence libre vers un futur gabarit de texte — aucune table de modèles n'existe encore,
     *  volontairement sans FK tant qu'elle n'existe pas (voir `contrats/relances/regle-relance.ts`). */
    texteModeleId: uuid('texte_modele_id'),
    prereglageAppliqueLe: timestamp('prereglage_applique_le', { withTimezone: true, mode: 'date' }),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('regle_relance_tenant_id_uk').on(t.tenantId, t.id),
    /** Une seule ligne de config par (tenant, type) — cible de l'upsert `PUT /relances/regles/
     *  {typeRelance}` (`onConflictDoUpdate`, `service-regle-relance.ts`). */
    unique('regle_relance_tenant_type_uk').on(t.tenantId, t.typeRelance),
    check(
      'regle_relance_delais_positifs_chk',
      sql`coalesce((select bool_and(d > 0) from unnest(${t.delaisJours}) as d), true)`,
    ),
  ],
);

export type LigneRegleRelance = typeof regleRelance.$inferSelect;
export type NouvelleRegleRelance = typeof regleRelance.$inferInsert;
