/**
 * Module pièces — `fournisseur`. RP-26. Détail des règles : migrations/0022_pieces_referentiel.sql.
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/ordre-reparation.ts (Z-17, 0011) — enums.ts n'importe rien de pieces, ce chemin direct
// est sûr.
import { origineDocumentEnum } from '../facturation/enums';
import { tenant } from '../tenant';
import { statutFournisseurEnum } from './enums';

export const fournisseur = pgTable(
  'fournisseur',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    /**
     * Reprise (migrations/0066_ancrages_origine_reprise.sql) : même enum et même sémantique que
     * documentVente.origine (0010) et ordreReparation.origine (0011) — dfa (créé par DFA) ou
     * reprise (importé).
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0066) : identifiant fournisseur source verbatim, jamais retouché. NULL si
     * origine=dfa — fournisseur n'a pas de numéro affiché propre. */
    numeroOrigine: text('numero_origine'),
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
    check(
      'fournisseur_telephone_e164_chk',
      sql`${t.telephone} is null or ${t.telephone} ~ '^\+[1-9][0-9]{6,14}$'`,
    ),
    check(
      'fournisseur_delai_habituel_chk',
      sql`${t.delaiHabituelJours} is null or ${t.delaiHabituelJours} between 0 and 3650`,
    ),
    // Reprise (0066) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'fournisseur_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // fournisseur_numero_origine_uk (index unique PARTIEL, where numero_origine is not null —
    // 0066) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL
    // brut, même limite que ordre_reparation_numero_origine_uk (0011).
    index('fournisseur_nom_idx').on(t.tenantId, t.nom),
    index('fournisseur_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
  ],
);

export type LigneFournisseur = typeof fournisseur.$inferSelect;
export type NouveauFournisseur = typeof fournisseur.$inferInsert;
