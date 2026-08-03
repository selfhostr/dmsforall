import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeLiberationReservation,
  ReponseAvecAvertissements,
  ReponseReservationPiece,
} from '@dfa/shared';

import { libererReservation, satisfaireReservation } from './reservations.api';

/** `POST /reservations/{id}/satisfaire` (RP-21) — génère le mouvement `sortie_or` : invalide la
 *  liste des réservations ET les mouvements/la fiche de l'article concerné (le magasinier ne
 *  connaît pas forcément l'id article ici, invalidation par préfixe large plutôt qu'un id précis
 *  qu'il faudrait faire remonter). */
export function useSatisfaireReservation(): UseMutationResult<
  ReponseReservationPiece,
  unknown,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => satisfaireReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'reservations', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'detail'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'mouvements'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'disponibilite'] });
    },
  });
}

interface VariablesLiberation {
  readonly id: string;
  readonly entree: EntreeLiberationReservation;
}

/** `POST /reservations/{id}/liberer` (RP-23, 3e cas — geste explicite du magasinier). */
export function useLibererReservation(): UseMutationResult<
  ReponseAvecAvertissements<ReponseReservationPiece>,
  unknown,
  VariablesLiberation
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesLiberation) => libererReservation(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'reservations', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'disponibilite'] });
    },
  });
}
