import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { clesParametrage } from './cles';
import {
  modifierEnvoiCourriel,
  recupererEnvoiCourriel,
  reinitialiserEnvoiCourriel,
  testerEnvoiCourriel,
  type EntreeModificationEnvoiCourriel,
  type EntreeTestEnvoiCourriel,
  type ReponseEnvoiCourriel,
  type ReponseTestEnvoiCourriel,
} from './envoi-courriel.api';

/** Réglage d'envoi des e-mails du garage et état courant (écran Réglages > Envoi des e-mails). */
export function useEnvoiCourriel(): UseQueryResult<ReponseEnvoiCourriel> {
  return useQuery({
    queryKey: clesParametrage.envoiCourriel(),
    queryFn: recupererEnvoiCourriel,
    retry: false,
    staleTime: 30 * 1000,
  });
}

export function useModifierEnvoiCourriel(): UseMutationResult<
  ReponseEnvoiCourriel,
  unknown,
  EntreeModificationEnvoiCourriel
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: modifierEnvoiCourriel,
    meta: { succes: 'parametrage:envoiCourriel.toast.enregistre' },
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesParametrage.envoiCourriel(), reponse);
    },
  });
}

export function useReinitialiserEnvoiCourriel(): UseMutationResult<ReponseEnvoiCourriel> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reinitialiserEnvoiCourriel,
    meta: { succes: 'parametrage:envoiCourriel.toast.supprime' },
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesParametrage.envoiCourriel(), reponse);
    },
  });
}

/** L'essai (réussi ou non) met à jour `dernierTest` côté serveur : on relit l'état dans les deux cas. */
export function useTesterEnvoiCourriel(): UseMutationResult<
  ReponseTestEnvoiCourriel,
  unknown,
  EntreeTestEnvoiCourriel
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: testerEnvoiCourriel,
    onSettled: () => queryClient.invalidateQueries({ queryKey: clesParametrage.envoiCourriel() }),
  });
}
