import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationRendezVous, ReponseRendezVous } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { modifierRendezVous } from './rendez-vous.api';

/** `PATCH /rendez-vous/{id}` — déplace un rendez-vous encore confirmé (RV-16 : le statut ne
 *  change jamais). Mêmes invalidations que les autres transitions : période + capacité. */
export function useDeplacerRendezVous(
  rdvId: string,
): UseMutationResult<ReponseRendezVous, unknown, EntreeModificationRendezVous> {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { succes: 'commun:toasts.rdvDeplace' },
    mutationFn: (entree: EntreeModificationRendezVous) => modifierRendezVous(rdvId, entree),
    onSuccess: (rendezVous) => {
      queryClient.setQueryData(clesQuery.rdv.detail(rdvId), rendezVous);
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'plage'] });
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'charge'] });
    },
  });
}
