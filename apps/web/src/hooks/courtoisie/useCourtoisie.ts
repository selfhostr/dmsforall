import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  EntreeCreationPretCourtoisie,
  EntreeCreationVehiculeCourtoisie,
  EntreeRetourPretCourtoisie,
  ReponseListeVehiculesCourtoisie,
  ReponsePretCourtoisie,
  ReponseVehiculeCourtoisie,
} from '@dfa/shared';

import {
  annulerPretCourtoisie,
  creerPretCourtoisie,
  creerVehiculeCourtoisie,
  listerVehiculesCourtoisie,
  remettrePretCourtoisie,
  rendrePretCourtoisie,
} from './courtoisie.api';

/** Clés locales au domaine : toute mutation invalide `['courtoisie']` en bloc. */
const RACINE = ['courtoisie'] as const;

export function useVehiculesCourtoisie(
  du: string,
  au: string,
): UseQueryResult<ReponseListeVehiculesCourtoisie> {
  return useQuery({
    queryKey: [...RACINE, 'vehicules', du, au],
    queryFn: () => listerVehiculesCourtoisie(du, au),
  });
}

function useMutationCourtoisie<TVar, TRes>(
  fn: (variables: TVar) => Promise<TRes>,
  succes?: string,
): UseMutationResult<TRes, unknown, TVar> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: succes ? { succes } : undefined,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RACINE }),
  });
}

export const useCreerVehiculeCourtoisie = (): UseMutationResult<
  ReponseVehiculeCourtoisie,
  unknown,
  EntreeCreationVehiculeCourtoisie
> => useMutationCourtoisie(creerVehiculeCourtoisie);

export const useCreerPretCourtoisie = (): UseMutationResult<
  ReponsePretCourtoisie,
  unknown,
  EntreeCreationPretCourtoisie
> => useMutationCourtoisie(creerPretCourtoisie, 'commun:toasts.pretCree');

export const useRendrePretCourtoisie = (): UseMutationResult<
  ReponsePretCourtoisie,
  unknown,
  { readonly id: string; readonly entree: EntreeRetourPretCourtoisie }
> => useMutationCourtoisie(({ id, entree }) => rendrePretCourtoisie(id, entree));

export const useRemettrePretCourtoisie = (): UseMutationResult<
  ReponsePretCourtoisie,
  unknown,
  string
> => useMutationCourtoisie((id: string) => remettrePretCourtoisie(id));

export const useAnnulerPretCourtoisie = (): UseMutationResult<
  ReponsePretCourtoisie,
  unknown,
  string
> => useMutationCourtoisie(annulerPretCourtoisie);
