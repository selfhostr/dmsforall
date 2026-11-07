import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationTravailReporte, ReponseTravailReporte } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { creerTravailReporteVehicule } from './travauxReportes.api';

/** `POST /vehicules/{id}/travaux-reportes` — invalide la liste dédiée et `contexte-atelier`
 *  (le travail noté doit ressortir tout de suite aux alertes de la fiche et du prochain OR). */
export function useCreerTravailReporte(
  vehiculeId: string,
): UseMutationResult<ReponseTravailReporte, unknown, EntreeCreationTravailReporte> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree: EntreeCreationTravailReporte) =>
      creerTravailReporteVehicule(vehiculeId, entree),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: clesQuery.vehicules.travauxReportes(vehiculeId),
        }),
        queryClient.invalidateQueries({
          queryKey: clesQuery.vehicules.contexteAtelier(vehiculeId),
        }),
      ]);
    },
  });
}
