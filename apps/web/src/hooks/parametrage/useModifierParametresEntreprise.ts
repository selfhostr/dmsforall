import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';

import { clesParametrage } from './cles';
import {
  modifierParametresEntreprise,
  type EntreeModificationParametresEntreprise,
  type ReponseParametresEntreprise,
} from './entreprise.api';

export function useModifierParametresEntreprise(): UseMutationResult<
  ReponseParametresEntreprise,
  unknown,
  EntreeModificationParametresEntreprise
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: modifierParametresEntreprise,
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesParametrage.entreprise(), reponse);
      // La session porte le réglage « Signalements » lu par le menu du profil.
      void queryClient.invalidateQueries({ queryKey: clesQuery.session() });
    },
  });
}
