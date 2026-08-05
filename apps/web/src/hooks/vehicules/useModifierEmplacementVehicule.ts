import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseAvecAvertissements, ReponseVehicule } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { modifierVehicule } from './vehicules.api';

/**
 * `PATCH /vehicules/{id}` restreint au seul champ `emplacementLibre` (migration `0044`, Lot C du
 * plan du parc simplifié) — un aide-mémoire de position dans le garage, PAS un formulaire général
 * de fiche : les autres champs de `EntreeModificationVehicule` restent hors périmètre de ce hook.
 * `null` efface l'emplacement — un champ vide est normal et fréquent (spec §1.1/§1.3), jamais une
 * erreur à rattraper ici.
 *
 * `setQueryData` DIRECT sur `vehicules.detail` (la réponse complète `ReponseVehicule` est déjà
 * connue, aucun round-trip nécessaire pour que la fiche reflète le nouvel emplacement) + une
 * invalidation du PRÉFIXE `vehicules.liste` (la colonne « emplacement » de la liste doit aussi se
 * rafraîchir) — même patron que `useCreerVehicule`/`useEnregistrerKilometrage`.
 */
export function useModifierEmplacementVehicule(
  vehiculeId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseVehicule>, unknown, string | null> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (emplacementLibre: string | null) =>
      modifierVehicule(vehiculeId, { emplacementLibre }),
    onSuccess: async (reponse) => {
      queryClient.setQueryData(clesQuery.vehicules.detail(vehiculeId), reponse.donnees);
      await queryClient.invalidateQueries({ queryKey: ['vehicules', 'liste'] });
    },
  });
}
