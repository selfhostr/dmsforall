/**
 * Énumérations Postgres du hangar à pneus (Lot A, `docs/specification-parc-et-hangar-pneus.md`).
 *
 * Dérivées de `@dfa/shared` (`contrats/pneus/enums.ts`), SOURCE UNIQUE — même doctrine que
 * `schema/pieces/enums.ts`. Les types PG sont créés dans
 * `migrations/0043_pneus_depot_pneus.sql`.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import { MOTIFS_SORTIE_DEPOT_PNEUS, SAISONS_PNEU, STATUTS_DEPOT_PNEUS } from '@dfa/shared';

// --- 0043 (depot_pneus) ----------------------------------------------------------------------
export const saisonPneuEnum = pgEnum('saison_pneu', SAISONS_PNEU);
export const statutDepotPneusEnum = pgEnum('statut_depot_pneus', STATUTS_DEPOT_PNEUS);
export const motifSortieDepotPneusEnum = pgEnum(
  'motif_sortie_depot_pneus',
  MOTIFS_SORTIE_DEPOT_PNEUS,
);
