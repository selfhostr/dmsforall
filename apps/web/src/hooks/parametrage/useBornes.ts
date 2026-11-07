import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  BorneResume,
  EntreeCreationBorne,
  PageBorneResume,
  ReponseAccesTemporaire,
  ReponseCreationBorne,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { exigerCorps } from './support';

const CLE_LISTE = ['bornes', 'liste'] as const;
const LIMITE_PAR_PAGE = 50;

/** `GET /bornes` — bornes d'atelier du garage (comptes de service `poste_atelier`). */
export function useListeBornes(): UseInfiniteQueryResult<InfiniteData<PageBorneResume>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<BorneResume>({
    cle: CLE_LISTE,
    charger: async (curseur) => {
      const params = new URLSearchParams({ limite: String(LIMITE_PAR_PAGE) });
      if (curseur) params.set('curseur', curseur);
      const page = await requeteApi<PageBorneResume>(`/bornes?${params.toString()}`, {
        method: 'GET',
      });
      return exigerCorps(page, 'GET /bornes');
    },
    reessayer,
  });
  return resultat;
}

/** `POST /bornes` — le mot de passe n'est rendu qu'ici, une seule fois : jamais mis en cache. */
export function useCreerBorne(): UseMutationResult<
  ReponseCreationBorne,
  unknown,
  EntreeCreationBorne
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree: EntreeCreationBorne) =>
      requeteApi<ReponseCreationBorne>('/bornes', {
        method: 'POST',
        body: JSON.stringify(entree),
      }).then((reponse) => exigerCorps(reponse, 'POST /bornes')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CLE_LISTE }),
  });
}

export type ActionBorne = 'desactiver' | 'reactiver';

/** `POST /bornes/{id}/desactiver|reactiver`. */
export function useBasculerBorne(
  action: ActionBorne,
): UseMutationResult<BorneResume, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (borneId: string) =>
      requeteApi<BorneResume>(`/bornes/${borneId}/${action}`, { method: 'POST' }).then((r) =>
        exigerCorps(r, `POST /bornes/${borneId}/${action}`),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CLE_LISTE }),
  });
}

/** `POST /bornes/{id}/reinitialiser-acces` — nouveau mot de passe, rendu une seule fois. */
export function useReinitialiserAccesBorne(): UseMutationResult<
  ReponseAccesTemporaire,
  unknown,
  string
> {
  return useMutation({
    mutationFn: (borneId: string) =>
      requeteApi<ReponseAccesTemporaire>(`/bornes/${borneId}/reinitialiser-acces`, {
        method: 'POST',
      }).then((r) => exigerCorps(r, `POST /bornes/${borneId}/reinitialiser-acces`)),
  });
}
