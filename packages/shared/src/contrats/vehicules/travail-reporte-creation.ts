import { z } from 'zod';

import {
  schemaCentimesPositif,
  schemaIdentifiant,
  schemaTexteCourt,
  schemaTexteLong,
} from '../atelier/primitives';
import { URGENCES_TRAVAIL } from '../atelier/enums';

/**
 * `POST /vehicules/{vehiculeId}/travaux-reportes` — noter un travail « à faire la prochaine fois »
 * (RM-73), depuis la fiche véhicule ou un OR. `ordreReparationOrigineId` absent = saisie libre.
 * Priorité facultative : `a_faire` par défaut.
 */
export const schemaCreationTravailReporte = z
  .object({
    designation: schemaTexteCourt,
    detail: schemaTexteLong.optional(),
    urgence: z.enum(URGENCES_TRAVAIL).optional(),
    securite: z.boolean().optional(),
    montantEstimeCentimes: schemaCentimesPositif.nullish(),
    ordreReparationOrigineId: schemaIdentifiant.optional(),
  })
  .strict();

export type EntreeCreationTravailReporte = z.infer<typeof schemaCreationTravailReporte>;
