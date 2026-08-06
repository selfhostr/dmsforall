import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { ReponsePlanificationRelances } from '@dfa/shared';

import { planifierRelancesFacture } from './relances.api';

/**
 * `POST /relances/facturation/planifier` — opération APPELABLE à la demande (aucun ordonnanceur,
 * voir le contrôleur). Idempotente côté serveur (RA-05, contrainte unique en base) : relancer ne
 * crée jamais de doublon. Pas d'invalidation de cache : aucune liste de relances planifiées n'est
 * exposée par l'API à ce jour — l'écran affiche le bilan (`creees`/`ignorees`) rendu par l'appel.
 */
export function usePlanifierRelances(): UseMutationResult<
  ReponsePlanificationRelances,
  unknown,
  void
> {
  return useMutation({
    mutationFn: () => planifierRelancesFacture(),
  });
}
