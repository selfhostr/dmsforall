import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeKilometrageVehicule,
  ReponseAvecAvertissements,
  ReponseVehiculeKilometrage,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { creerKilometrageVehicule } from './vehicules.api';

/** `POST /vehicules/{id}/kilometrages`. Un `409 VEHICULE_KILOMETRAGE_REGRESSIF` (sans
 *  `motifRegression`) n'est PAS rattrapé ici — il remonte tel quel (`ErreurApi`) pour que l'écran
 *  déclenche `AvertissementConfirmable` et rejoue avec un motif (RM-23/24/25). Invalide
 *  l'historique ET le contexte-atelier (le dernier relevé affiché change dans les deux). */
export function useEnregistrerKilometrage(
  vehiculeId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseVehiculeKilometrage>,
  unknown,
  EntreeKilometrageVehicule
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeKilometrageVehicule) => creerKilometrageVehicule(vehiculeId, entree),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clesQuery.vehicules.kilometrages(vehiculeId) }),
        queryClient.invalidateQueries({
          queryKey: clesQuery.vehicules.contexteAtelier(vehiculeId),
        }),
      ]);
    },
  });
}
