/**
 * `periode_comptable` (MD-34). Détail : migrations/0010_facturation.sql §5.
 *
 * L'EXCLUDE GiST empêchant deux périodes de se chevaucher pour un même tenant est posée en SQL
 * brut (migration) — non exprimable via `drizzle-kit` pg-core, même patron que
 * `taux_horaire`/`prestation_prix` (`schema/atelier/parametrage.ts`).
 */

import { date, foreignKey, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';

export const periodeComptable = pgTable(
  'periode_comptable',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    debut: date('debut').notNull(),
    fin: date('fin').notNull(),
    clotureeLe: timestamp('cloturee_le', { withTimezone: true, mode: 'date' }),
    clotureeParId: uuid('cloturee_par_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('periode_comptable_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'periode_comptable_fk_cloturee_par',
      columns: [t.tenantId, t.clotureeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    // periode_comptable_periode_chk (fin >= debut) et l'EXCLUDE GiST de non-chevauchement sont
    // posés en SQL brut (migration §5) — non exprimables ici.
  ],
);

export type LignePeriodeComptable = typeof periodeComptable.$inferSelect;
