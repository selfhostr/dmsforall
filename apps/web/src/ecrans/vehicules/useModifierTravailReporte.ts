import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationTravailReporte, ReponseTravailReporte } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { modifierTravailReporteVehicule } from './travauxReportes.api';

interface VariablesModificationTravailReporte {
  readonly travailId: string;
  readonly entree: EntreeModificationTravailReporte;
}

/** `PATCH /vehicules/{id}/travaux-reportes/{travailId}` (RM-73) — invalide la liste dédiée ET
 *  `contexte-atelier` (dont la section `travauxReportes` change aussi : un travail clos/abandonné
 *  ne doit plus apparaître dans les alertes « sans cliquer », `EncartAlertesVehicule`). Les deux
 *  clés sont déjà gelées dans `api/cles.ts` — ce hook ne fait qu'invalider, jamais écrire dessus. */
export function useModifierTravailReporte(
  vehiculeId: string,
): UseMutationResult<ReponseTravailReporte, unknown, VariablesModificationTravailReporte> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ travailId, entree }: VariablesModificationTravailReporte) =>
      modifierTravailReporteVehicule(vehiculeId, travailId, entree),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clesQuery.vehicules.travauxReportes(vehiculeId) }),
        queryClient.invalidateQueries({ queryKey: clesQuery.vehicules.contexteAtelier(vehiculeId) }),
      ]);
    },
  });
}
