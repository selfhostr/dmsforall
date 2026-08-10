import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeChangementDetenteur,
  ReponseAvecAvertissements,
  ReponseVehicule,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { changerDetenteurVehicule } from './detention.api';

/**
 * Invalide la fiche véhicule (`clesQuery.vehicules.detail`, la carte « Propriétaire » en dépend
 * via `proprietaireActuel`) et l'historique des détentions.
 *
 * Clé `['vehicules', 'detentions', vehiculeId]` DUPLIQUÉE plutôt qu'importée : `cleDetentionsVehicule`
 * (`hooks/vehicules/useDetentionsVehicule.ts`) n'est pas exportée — son propre commentaire de tête
 * l'assume déjà (« GAP DE CLÉ ASSUMÉ », `@/api/cles.ts` gelé pour le lot 1 sans entrée
 * `vehicules.detentions`) et note explicitement qu'aucune invalidation croisée n'en dépendait
 * ENCORE ailleurs — ce hook en devient la première. Le tableau littéral est le contrat réel côté
 * `useQuery`, la clé non exportée n'a rien de privé au sens TypeScript.
 */
export function useChangerDetenteurVehicule(
  vehiculeId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseVehicule>,
  unknown,
  EntreeChangementDetenteur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeChangementDetenteur) => changerDetenteurVehicule(vehiculeId, entree),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicules', 'detentions', vehiculeId] }),
        queryClient.invalidateQueries({ queryKey: clesQuery.vehicules.detail(vehiculeId) }),
      ]);
    },
  });
}
