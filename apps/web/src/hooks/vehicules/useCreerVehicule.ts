import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationVehicule,
  ReponseAvecAvertissements,
  ReponseVehicule,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

interface VariablesCreationVehicule {
  readonly entree: EntreeCreationVehicule;
  /** Générée par `useCleIdempotence` au montage du formulaire — même contrat que
   *  `useCreerClient` (`hooks/clients/useCreerClient.ts`) : un rejeu (double-clic, retry après
   *  timeout) ne doit jamais créer deux fiches pour le même véhicule. */
  readonly idempotencyKey: string;
}

/**
 * `POST /vehicules` (`vehicule.controller.ts`) — `Idempotency-Key` OBLIGATOIRE côté serveur : un
 * doublon de véhicule pollue durablement la recherche par plaque, l'entrée n°1 du comptoir. Un VIN
 * court (< 17 caractères) ou absent n'est PAS un refus (RM-15) : il voyage en avertissement
 * `VEHICULE_VIN_COURT` dans `avertissements[]` d'une réponse `2xx`, jamais un blocage — même
 * mécanique que `CLIENT_DOUBLON_PROBABLE` sur `useCreerClient`.
 */
export function useCreerVehicule(): UseMutationResult<
  ReponseAvecAvertissements<ReponseVehicule>,
  unknown,
  VariablesCreationVehicule
> {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { succes: 'commun:toasts.vehiculeCree' },
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationVehicule) =>
      requeteApi<ReponseAvecAvertissements<ReponseVehicule>>('/vehicules', {
        method: 'POST',
        body: JSON.stringify(entree),
        idempotencyKey,
      }).then((reponse) => {
        if (!reponse) throw new Error('Réponse vide inattendue : POST /vehicules.');
        return reponse;
      }),
    onSuccess: () => {
      // Préfixe seul (pas `clesQuery.vehicules.liste(...)` d'un filtre précis) : une création doit
      // invalider TOUTE variante de filtre/tri de la liste — même raisonnement que
      // `useCreerClient`. Pas de `setQueryData` sur `vehicules.detail` : la fiche du véhicule
      // fraîchement créé n'a jamais été visitée, rien à préremplir.
      void queryClient.invalidateQueries({ queryKey: ['vehicules', 'liste'] });
    },
  });
}
