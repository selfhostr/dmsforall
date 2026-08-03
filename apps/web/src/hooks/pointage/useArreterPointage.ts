import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeArretPointage, ReponseAvecAvertissements, ReponsePointage } from '@dfa/shared';

import { clesPointage } from './cles';
import { arreterPointage } from './pointage.api';

interface VariablesArretPointage {
  readonly id: string;
  readonly technicienId: string;
  readonly siteId: string;
  readonly entree: EntreeArretPointage;
  readonly idempotencyKey: string;
}

interface ContexteOptimiste {
  readonly precedent: ReponsePointage | null | undefined;
}

/**
 * `POST /pointages/{id}/arreter` — optimiste, symétrique de `useDemarrerPointage` : le chrono
 * doit s'arrêter au tap, pas après l'aller-retour réseau. `onMutate` vide immédiatement le cache
 * `ouvertTechnicien` (plus aucun pointage en cours pour ce technicien, du point de vue de l'écran) ;
 * `onError` restaure l'ancien pointage (le chrono reprend, l'utilisateur retente) ; `onSuccess` ne
 * fait QUE réconcilier le cache de détail — `ouvertTechnicien` reste `null`, RM-116 garantit qu'un
 * arrêt réussi ne laisse jamais de pointage `en_cours` derrière lui.
 *
 * Rappel RM-116 : une « pause » est cet appel suivi d'un `POST /pointages` ordinaire sur l'activité
 * `pause` — c'est l'écran (`EcranPointageTechnicien`) qui enchaîne les deux appels, ce hook ne
 * connaît que l'arrêt.
 */
export function useArreterPointage(): UseMutationResult<
  ReponseAvecAvertissements<ReponsePointage>,
  unknown,
  VariablesArretPointage,
  ContexteOptimiste
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree, idempotencyKey }: VariablesArretPointage) => arreterPointage(id, entree, idempotencyKey),

    onMutate: async ({ technicienId }) => {
      const cle = clesPointage.ouvertTechnicien(technicienId);
      await queryClient.cancelQueries({ queryKey: cle });
      const precedent = queryClient.getQueryData<ReponsePointage | null>(cle);
      queryClient.setQueryData(cle, null);
      return { precedent };
    },

    onError: (_erreur, { technicienId }, contexte) => {
      queryClient.setQueryData(clesPointage.ouvertTechnicien(technicienId), contexte?.precedent ?? null);
    },

    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPointage.detail(reponse.donnees.id), reponse.donnees);
    },

    onSettled: (_reponse, _erreur, { technicienId, siteId }) => {
      void queryClient.invalidateQueries({ queryKey: ['pointages', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['pointages', 'technicienJour', technicienId] });
      void queryClient.invalidateQueries({ queryKey: clesPointage.ouvertsSite(siteId) });
    },
  });
}
