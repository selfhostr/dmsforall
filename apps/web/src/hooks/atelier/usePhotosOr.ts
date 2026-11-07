import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import type { ReponsePhotoLigne } from '@dfa/shared';

import { envoyerPhotoLigne, listerPhotosOr, supprimerPhoto, type EnvoiPhoto } from './photos.api';

const PHOTOS_VIDES: readonly ReponsePhotoLigne[] = [];

export const clePhotosOr = (orId: string) => ['or', 'photos', orId] as const;

/**
 * Toutes les photos d'un OR en UNE requête ; chaque ligne en tire ses vignettes par `select`
 * (même clé -> une seule requête partagée, quel que soit le nombre de lignes affichées).
 * Une erreur (droit de lecture absent, réseau) rend simplement une liste vide : une photo qui ne
 * charge pas ne doit jamais empêcher de travailler sur la ligne.
 */
export function usePhotosLigne(orId: string, ligneId: string) {
  const requete = useQuery({
    queryKey: clePhotosOr(orId),
    queryFn: () => listerPhotosOr(orId),
    staleTime: 30_000,
    retry: false,
    select: (toutes) => toutes.filter((photo) => photo.ligneId === ligneId),
  });
  return { photos: requete.data ?? PHOTOS_VIDES, chargement: requete.isPending };
}

interface VariablesEnvoi extends EnvoiPhoto {
  readonly ligneId: string;
}

export function useAjouterPhotoLigne(
  orId: string,
): UseMutationResult<ReponsePhotoLigne, unknown, VariablesEnvoi> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ligneId, ...envoi }: VariablesEnvoi) => envoyerPhotoLigne(orId, ligneId, envoi),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clePhotosOr(orId) });
    },
  });
}

export function useSupprimerPhoto(orId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => supprimerPhoto(photoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clePhotosOr(orId) });
    },
  });
}
