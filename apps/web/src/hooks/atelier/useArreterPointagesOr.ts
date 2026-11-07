import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';
import { genererCleIdempotence } from '@/api/idempotence';
import { arreterPointage } from '@/hooks/pointage/pointage.api';

/**
 * « Arrêter les pointages » listés par un refus `OR_POINTAGE_OUVERT` (action proposée
 * `ARRETER_POINTAGES`) : `POST /pointages/{id}/arreter` pour CHAQUE pointage, une à la fois, arrêt
 * à l'instant du clic. S'arrête à la première erreur (relancée telle quelle, `ErreurApi`) ; un
 * pointage déjà arrêté lors d'un essai précédent est rejoué sans effet grâce à l'idempotence côté
 * serveur. Le document OR et les listes de pointage sont relus dans tous les cas.
 */
export function useArreterPointagesOr(
  orId: string,
): UseMutationResult<number, unknown, readonly string[]> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pointageIds: readonly string[]) => {
      const finLe = new Date().toISOString();
      let arretes = 0;
      for (const id of new Set(pointageIds)) {
        await arreterPointage(id, { finLe }, genererCleIdempotence());
        arretes += 1;
      }
      return arretes;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.or.detail(orId) });
      void queryClient.invalidateQueries({ queryKey: ['pointages'] });
    },
  });
}
