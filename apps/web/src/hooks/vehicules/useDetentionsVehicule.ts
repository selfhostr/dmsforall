import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseVehiculeDetention } from '@dfa/shared';

import { listerDetentionsVehicule } from './vehicules.api';

/**
 * `GET /vehicules/{id}/detentions` (RM-20/21).
 *
 * GAP DE CLÉ ASSUMÉ : `@/api/cles.ts` (gelé pour l'étape 1, vague 0 — voir son en-tête) ne réserve
 * pas d'entrée `vehicules.detentions`, seulement `liste/detail/contexteAtelier/travauxReportes/
 * kilometrages`. Clé locale, DANS le périmètre de ce hook (`src/hooks/vehicules/**`), pour ne pas
 * modifier un fichier hors périmètre — aucune invalidation croisée n'en dépend ailleurs au lot 1
 * (cet écran ne modifie pas les détentions, `changer-detenteur` n'a pas d'écran ici).
 */
const cleDetentionsVehicule = (vehiculeId: string) =>
  ['vehicules', 'detentions', vehiculeId] as const;

export function useDetentionsVehicule(
  vehiculeId: string | undefined,
): UseQueryResult<readonly ReponseVehiculeDetention[]> {
  return useQuery({
    queryKey: cleDetentionsVehicule(vehiculeId ?? ''),
    queryFn: () => listerDetentionsVehicule(vehiculeId as string),
    enabled: Boolean(vehiculeId),
  });
}
