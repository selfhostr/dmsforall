import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationFournisseur, ReponseAvecAvertissements, ReponseFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { desactiverFournisseur, modifierFournisseur, reactiverFournisseur } from './fournisseurs.api';

/**
 * Une mutation par action nommée sur un fournisseur — même patron que `useTransitionsArticle` :
 * chaque action renvoie le fournisseur COMPLET, posé directement dans le cache via
 * `setQueryData`, et invalide la liste par PRÉFIXE.
 */
function useActionFournisseur<TEntree>(
  id: string,
  action: (id: string, entree: TEntree) => Promise<ReponseAvecAvertissements<ReponseFournisseur>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseFournisseur>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(id, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.fournisseurs.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'fournisseurs', 'liste'] });
    },
  });
}

/** `PATCH /fournisseurs/{id}`. */
export function useModifierFournisseur(id: string) {
  return useActionFournisseur<EntreeModificationFournisseur>(id, modifierFournisseur);
}

/** `POST /fournisseurs/{id}/desactiver` — aucun corps. */
export function useDesactiverFournisseur(id: string): UseMutationResult<ReponseAvecAvertissements<ReponseFournisseur>, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => desactiverFournisseur(id),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.fournisseurs.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'fournisseurs', 'liste'] });
    },
  });
}

/** `POST /fournisseurs/{id}/reactiver` — aucun corps. */
export function useReactiverFournisseur(id: string): UseMutationResult<ReponseAvecAvertissements<ReponseFournisseur>, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => reactiverFournisseur(id),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.fournisseurs.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'fournisseurs', 'liste'] });
    },
  });
}
