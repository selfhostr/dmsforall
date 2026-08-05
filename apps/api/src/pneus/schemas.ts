import { z } from 'zod';
import {
  schemaFiltresARelancerPneus,
  schemaFiltresDepotsPneusVehicule,
  schemaFiltresHangarPneus,
} from '@dfa/shared';

export { schemaFiltresARelancerPneus, schemaFiltresDepotsPneusVehicule, schemaFiltresHangarPneus };
export type {
  FiltresARelancerPneus,
  FiltresDepotsPneusVehicule,
  FiltresHangarPneus,
} from '@dfa/shared';

/** Identifiant de chemin, réutilisé sur chaque contrôleur (`:siteId`, `:vehiculeId`, `:id`…) —
 *  même doctrine que `pieces/schemas.ts`. */
export const schemaUuid = z.string().uuid();
