import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationRendezVous, ReponseRendezVousAvecAvertissements } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { creerRendezVous } from './rendez-vous.api';

interface VariablesCreationRendezVous {
  readonly entree: EntreeCreationRendezVous;
  /** Générée par `useCreationRendezVous` — une NOUVELLE clé est requise avant tout rejeu qui
   *  ajoute `confirmations[]` au corps (voir `api/idempotence.ts`). */
  readonly idempotencyKey: string;
}

/**
 * `POST /rendez-vous` — couche TanStack Query pure (mutation), sans logique de confirmation ni de
 * clé d'idempotence : orchestrée par `useCreationRendezVous.ts`, même séparation que
 * `hooks/atelier/useCreerOrdreReparation.ts`/`useCreationOrdreReparation.ts`.
 *
 * `onSuccess` pose le document créé dans le cache de sa propre fiche (`rdv.detail`) et invalide la
 * PÉRIODE par préfixe (`['rdv', 'plage']`/`['rdv', 'charge']`) : une création doit rafraîchir
 * l'agenda ET la capacité affichés, quels que soient les bornes `du`/`au` déjà en cache.
 */
export function useCreerRendezVous(): UseMutationResult<
  ReponseRendezVousAvecAvertissements,
  unknown,
  VariablesCreationRendezVous
> {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { succes: 'commun:toasts.rdvCree' },
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationRendezVous) =>
      creerRendezVous(entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.rdv.detail(reponse.donnees.id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'plage'] });
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'charge'] });
    },
  });
}
