import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { EntreeModificationCapacites, ModeleCapacites, UtilisateurResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { exigerCorps } from './support';

/** `GET /capacites/modele` — domaines, niveaux, options et préréglages (clés i18n, jamais de
 *  texte). Quasi statique : même modèle pour toute la session. */
export function useModeleCapacites(): UseQueryResult<ModeleCapacites> {
  return useQuery({
    queryKey: ['capacites', 'modele'] as const,
    queryFn: async () =>
      exigerCorps(
        await requeteApi<ModeleCapacites>('/capacites/modele', { method: 'GET' }),
        'GET /capacites/modele',
      ),
    staleTime: 60 * 60 * 1000,
  });
}

interface VariablesModificationCapacites {
  readonly utilisateurId: string;
  readonly entree: EntreeModificationCapacites;
}

/** `PATCH /utilisateurs/{id}/capacites` — corps partiel. Rafraîchit la liste des employés et la
 *  session (les droits de la personne connectée peuvent changer si elle se modifie... ce que le
 *  serveur refuse, mais la session reste la source de vérité). */
export function useModifierCapacites(): UseMutationResult<
  UtilisateurResume,
  unknown,
  VariablesModificationCapacites
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ utilisateurId, entree }: VariablesModificationCapacites) =>
      requeteApi<UtilisateurResume>(`/utilisateurs/${utilisateurId}/capacites`, {
        method: 'PATCH',
        body: JSON.stringify(entree),
      }).then((reponse) => exigerCorps(reponse, `PATCH /utilisateurs/${utilisateurId}/capacites`)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.utilisateurs.liste() });
      void queryClient.invalidateQueries({ queryKey: clesQuery.session() });
    },
  });
}
