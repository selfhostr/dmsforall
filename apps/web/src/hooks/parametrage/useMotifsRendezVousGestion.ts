import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationMotifRendezVous,
  EntreeModificationMotifRendezVous,
  ReponseMotifRendezVous,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { exigerCorps } from './support';

/** `POST /motifs-rendez-vous` — 409 `CONFLIT` si le code est déjà pris dans ce garage. */
export function useCreerMotifRendezVous(): UseMutationResult<
  ReponseMotifRendezVous,
  unknown,
  EntreeCreationMotifRendezVous
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree: EntreeCreationMotifRendezVous) =>
      requeteApi<ReponseMotifRendezVous>('/motifs-rendez-vous', {
        method: 'POST',
        body: JSON.stringify(entree),
      }).then((reponse) => exigerCorps(reponse, 'POST /motifs-rendez-vous')),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: clesQuery.referentiels.motifsRdv() }),
  });
}

export interface ModificationMotifRendezVous {
  readonly id: string;
  readonly entree: EntreeModificationMotifRendezVous;
}

/** `PATCH /motifs-rendez-vous/{id}` — `actif: false` désactive (il n'existe pas de DELETE). */
export function useModifierMotifRendezVous(): UseMutationResult<
  ReponseMotifRendezVous,
  unknown,
  ModificationMotifRendezVous
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entree }: ModificationMotifRendezVous) =>
      requeteApi<ReponseMotifRendezVous>(`/motifs-rendez-vous/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(entree),
      }).then((reponse) => exigerCorps(reponse, `PATCH /motifs-rendez-vous/${id}`)),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: clesQuery.referentiels.motifsRdv() }),
  });
}
