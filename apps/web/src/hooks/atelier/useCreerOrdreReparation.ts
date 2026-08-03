import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationOrdreReparation,
  ReponseAvecAvertissements,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { creerOrdreReparation } from './ordres-reparation.api';

interface VariablesCreationOrdreReparation {
  readonly entree: EntreeCreationOrdreReparation;
  /** Générée par `useCreationOrdreReparation` (RM-49 : un rejeu ne doit jamais brûler un numéro
   *  d'OR). Une NOUVELLE clé est requise avant tout rejeu qui ajoute `confirmations[]` au corps —
   *  voir le commentaire d'en-tête de `api/idempotence.ts`. */
  readonly idempotencyKey: string;
}

/**
 * `POST /ordres-reparation` — couche TanStack Query pure (mutation), sans logique de confirmation
 * ni de clé d'idempotence : cette partie est orchestrée par `useCreationOrdreReparation.ts`, qui
 * consomme ce hook. Même séparation que `hooks/atelier/useTransitionsOrdreReparation.ts`.
 *
 * `onSuccess` pose directement le document créé dans le cache de sa propre fiche (`or.detail`,
 * comme après toute transition — « l'écran d'OR est l'écran le plus rafraîchi du produit ») pour
 * que la navigation vers `/ordres-reparation/{id}` qui suit une création n'émette pas un `GET`
 * redondant. Les listes sont invalidées par PRÉFIXE (`['or', 'liste']`), comme `useCreerClient` :
 * une création doit invalider toute variante de filtre/tri déjà en cache, pas seulement celle
 * affichée à cet instant. `clients.ordres` (onglet « derniers passages » de la fiche client) est
 * invalidé explicitement : ce n'est pas sous le préfixe `or`, et un retour à la fiche client juste
 * après création ne doit pas montrer une liste périmée.
 */
export function useCreerOrdreReparation(): UseMutationResult<
  ReponseAvecAvertissements<ReponseOrdreReparation>,
  unknown,
  VariablesCreationOrdreReparation
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationOrdreReparation) =>
      creerOrdreReparation(entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.or.detail(reponse.donnees.id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
      void queryClient.invalidateQueries({
        queryKey: clesQuery.clients.ordres(reponse.donnees.client.id),
      });
    },
  });
}
