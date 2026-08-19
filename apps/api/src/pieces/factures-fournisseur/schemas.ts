import { z } from 'zod';
import {
  schemaFiltresFacturesFournisseur,
  schemaRejetFactureFournisseur,
  type EntreeRejetFactureFournisseur,
  type FiltresFacturesFournisseur,
} from '@dfa/shared';

export { schemaFiltresFacturesFournisseur, schemaRejetFactureFournisseur };
export type { EntreeRejetFactureFournisseur, FiltresFacturesFournisseur };

/** Identifiant de chemin — même doctrine que `pieces/schemas.ts#schemaUuid`. */
export const schemaUuid = z.string().uuid();
