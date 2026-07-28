import type { z } from 'zod';
import {
  schemaClotureDetention,
  schemaCloturePlaque,
  schemaFiltresKilometrages,
  schemaFiltresTravauxReportes,
  schemaModificationCampagneVehicule,
} from '@dfa/shared';

/**
 * Types dérivés localement pour les schémas `@dfa/shared` qui n'exportent qu'un schéma zod, sans
 * type `Entree*` correspondant (à la différence de la majorité des schémas d'écriture du module).
 * Signalé, pas un manque bloquant : `z.infer` reste la source de vérité, ce fichier ne fait que
 * lui donner un nom réutilisable dans ce module.
 */
export type EntreeCloturePlaqueVehicule = z.infer<typeof schemaCloturePlaque>;
export type EntreeClotureDetentionVehicule = z.infer<typeof schemaClotureDetention>;
export type EntreeModificationCampagneVehicule = z.infer<typeof schemaModificationCampagneVehicule>;
export type FiltresKilometrages = z.infer<typeof schemaFiltresKilometrages>;
export type FiltresTravauxReportes = z.infer<typeof schemaFiltresTravauxReportes>;
