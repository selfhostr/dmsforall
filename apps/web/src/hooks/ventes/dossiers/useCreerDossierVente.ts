import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationDossierVente,
  ReponseAvecAvertissements,
  ReponseDossierVente,
} from '@dfa/shared';

import { creerDossierVente } from './dossiers-vente.api';

interface VariablesCreationDossierVente {
  readonly entree: EntreeCreationDossierVente;
  /** Générée par `useCleIdempotence` à l'ouverture de l'écran de création (RV-29 : un rejeu ne
   *  doit jamais ouvrir un second dossier pour la même intention commerciale). */
  readonly idempotencyKey: string;
}

/** `POST /dossiers-vente` — même patron que `useCreerArticle`/`useCreerClient` : invalidation par
 *  PRÉFIXE de la liste (toute variante de filtre/tri), pas de préremplissage de la fiche (jamais
 *  visitée avant la redirection vers `EcranFicheDossierVente`). */
export function useCreerDossierVente(): UseMutationResult<
  ReponseAvecAvertissements<ReponseDossierVente>,
  unknown,
  VariablesCreationDossierVente
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationDossierVente) =>
      creerDossierVente(entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ventes', 'dossiers', 'liste'] });
    },
  });
}
