import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreePlaqueVehicule, ReponseVehiculePlaque } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { attribuerPlaqueVehicule } from './vehicules.api';

/**
 * `POST /vehicules/{id}/plaques` — attribuer une plaque à un véhicule qui n'en porte aucune
 * aujourd'hui (`ReponseVehicule.plaque === null`, RM-17). Le geste « Modifier » de
 * `EnTeteFicheVehicule.tsx` s'en sert pour compléter une identification incomplète : un véhicule
 * enregistré sans plaque (défaut mesuré en test d'utilisabilité — perdre la saisie d'une plaque
 * après un refus silencieux poussait à l'abandonner) doit pouvoir en recevoir une a posteriori,
 * sans repasser par la fiche client ni recréer le véhicule.
 *
 * `POST` ne renvoie que `ReponseVehiculePlaque` (pas le véhicule complet, contrairement à
 * `modifierVehicule`/`PATCH`) : `setQueryData` n'est donc pas possible ici — invalidation de la
 * fiche (`vehicules.detail`, `plaque`/`canton` y sont dérivés de la plaque courante) et du préfixe
 * `vehicules.liste` (recherche par plaque, colonne plaque des listes).
 */
export function useAttribuerPlaqueVehicule(
  vehiculeId: string,
): UseMutationResult<ReponseVehiculePlaque, unknown, EntreePlaqueVehicule> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreePlaqueVehicule) => attribuerPlaqueVehicule(vehiculeId, entree),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: clesQuery.vehicules.detail(vehiculeId) }),
        queryClient.invalidateQueries({ queryKey: ['vehicules', 'liste'] }),
      ]);
    },
  });
}
