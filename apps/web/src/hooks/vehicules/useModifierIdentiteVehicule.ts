import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeModificationVehicule,
  ReponseAvecAvertissements,
  ReponseVehicule,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { modifierVehicule } from './vehicules.api';

/**
 * `PATCH /vehicules/{id}` restreint à l'IDENTITÉ (VIN, code type CH, version, finition, 1re mise
 * en circulation) — le geste « Modifier » de `EnTeteFicheVehicule.tsx`, au minimum destiné à
 * compléter un VIN manquant (`ReponseVehicule.identificationIncomplete`, RM-16). `plaque`/`canton`
 * en sont volontairement absents : chacun a son propre endpoint historisé
 * (`useAttribuerPlaqueVehicule.ts`), même doctrine que `schemaModificationVehicule` côté contrat.
 *
 * Même patron d'invalidation que `useModifierEmplacementVehicule.ts` : `setQueryData` direct sur
 * la fiche (réponse complète déjà connue) + invalidation du préfixe `vehicules.liste` (VIN affiché
 * dans certaines colonnes/recherches de liste).
 */
export function useModifierIdentiteVehicule(
  vehiculeId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseVehicule>,
  unknown,
  Pick<
    EntreeModificationVehicule,
    'vin' | 'codeTypeCh' | 'version' | 'finition' | 'premiereMiseEnCirculationLe'
  >
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      entree: Pick<
        EntreeModificationVehicule,
        'vin' | 'codeTypeCh' | 'version' | 'finition' | 'premiereMiseEnCirculationLe'
      >,
    ) => modifierVehicule(vehiculeId, entree),
    onSuccess: async (reponse) => {
      queryClient.setQueryData(clesQuery.vehicules.detail(vehiculeId), reponse.donnees);
      await queryClient.invalidateQueries({ queryKey: ['vehicules', 'liste'] });
    },
  });
}
