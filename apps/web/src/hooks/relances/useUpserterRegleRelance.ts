import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeUpsertRegleRelance, ReponseRegleRelance, TypeRelance } from '@dfa/shared';

import { clesRelances } from './cles';
import { upserterRegleRelance } from './relances.api';

export interface VariablesUpsertRegleRelance {
  readonly typeRelance: TypeRelance;
  readonly entree: EntreeUpsertRegleRelance;
}

/**
 * `PUT /relances/regles/{typeRelance}` — upsert idempotent. Invalide la liste des règles au succès
 * plutôt que de poser la réponse directement dans le cache : la liste est une COLLECTION (une
 * ligne par type), pas un singleton — refetcher garantit qu'un ajout d'un type jamais vu apparaît
 * sans logique de fusion manuelle. Sert aussi bien la modification manuelle que « activer le
 * préréglage » (même route, corps différent — voir `ecrans/relances/prereglages.ts`).
 */
export function useUpserterRegleRelance(): UseMutationResult<
  ReponseRegleRelance,
  unknown,
  VariablesUpsertRegleRelance
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ typeRelance, entree }: VariablesUpsertRegleRelance) =>
      upserterRegleRelance(typeRelance, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesRelances.regles() });
    },
  });
}
