/**
 * Module pièces — `fournisseur`. RP-26. Détail des règles : migrations/0022_pieces_referentiel.sql.
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { tenant } from '../tenant';
import { statutFournisseurEnum } from './enums';

export const fournisseur = pgTable(
  'fournisseur',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    nom: text('nom').notNull(),
    email: text('email'),
    telephone: text('telephone'),
    delaiHabituelJours: smallint('delai_habituel_jours'),
    statut: statutFournisseurEnum('statut').notNull().default('actif'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('fournisseur_tenant_id_uk').on(t.tenantId, t.id),
    check('fournisseur_nom_non_vide_chk', sql`length(btrim(${t.nom})) > 0`),
    check('fournisseur_telephone_e164_chk', sql`${t.telephone} is null or ${t.telephone} ~ '^\+[1-9][0-9]{6,14}$'`),
    check(
      'fournisseur_delai_habituel_chk',
      sql`${t.delaiHabituelJours} is null or ${t.delaiHabituelJours} between 0 and 3650`,
    ),
    index('fournisseur_nom_idx').on(t.tenantId, t.nom),
    index('fournisseur_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
  ],
);

export type LigneFournisseur = typeof fournisseur.$inferSelect;
export type NouveauFournisseur = typeof fournisseur.$inferInsert;
