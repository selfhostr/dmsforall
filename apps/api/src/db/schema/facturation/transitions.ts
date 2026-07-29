/**
 * `transition_document_autorisee` — machine à états en données de `document_vente`, PAR
 * `type_document` (RF-83, MD-17). Détail : migrations/0010_facturation.sql §6.
 *
 * [dfa:referentiel-partage] Pas de `tenant_id` : alimentée exclusivement par migration,
 * `dfa_app` n'y a que SELECT — mêmes garanties que `transition_autorisee` de l'étape 1 (0003).
 */

import { boolean, check, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { statutDocumentVenteEnum, typeDocumentVenteEnum } from './enums';

export const transitionDocumentAutorisee = pgTable(
  'transition_document_autorisee',
  {
    typeDocument: typeDocumentVenteEnum('type_document').notNull(),
    statutDepuis: statutDocumentVenteEnum('statut_depuis').notNull(),
    statutVers: statutDocumentVenteEnum('statut_vers').notNull(),
    exigeMotif: boolean('exige_motif').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.typeDocument, t.statutDepuis, t.statutVers] }),
    check('transition_document_autorisee_pas_de_boucle', sql`${t.statutDepuis} <> ${t.statutVers}`),
  ],
);

export type LigneTransitionDocumentAutorisee = typeof transitionDocumentAutorisee.$inferSelect;
