import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { ReponseLogoEntreprise } from '@dfa/shared';

import { clesParametrage } from './cles';
import {
  deposerLogoEntreprise,
  estRefusDroitLogo,
  recupererLogoEntreprise,
  supprimerLogoEntreprise,
} from './logo-entreprise.api';

/** Le logo du garage : `Blob`, ou `null` quand aucun n'est déposé. */
export function useLogoEntreprise(): UseQueryResult<Blob | null> {
  return useQuery({
    queryKey: clesParametrage.logo(),
    queryFn: recupererLogoEntreprise,
    // Un refus de droit ne se réessaie pas ; une panne réseau, une fois.
    retry: (nombre, erreur) => !estRefusDroitLogo(erreur) && nombre < 1,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeposerLogoEntreprise(): UseMutationResult<
  ReponseLogoEntreprise,
  unknown,
  File
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deposerLogoEntreprise,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clesParametrage.logo() }),
  });
}

export function useSupprimerLogoEntreprise(): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: supprimerLogoEntreprise,
    onSuccess: () => queryClient.setQueryData(clesParametrage.logo(), null),
  });
}
