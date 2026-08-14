import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseAvecAvertissements, ReponseVehicule } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { modifierVehicule } from '@/hooks/vehicules/vehicules.api';

/** Sous-ensemble de `EntreeModificationVehicule` (@dfa/shared) écrit par ce hook — les trois seuls
 *  champs de garantie (`RM-33`), saisis EXPLICITEMENT par le vendeur : jamais de valeur devinée
 *  ou dérivée ici (voir `DialogueGarantieVehiculeStock`, l'unique appelant). */
export interface EntreeGarantieVehiculeStock {
  readonly garantieDebutLe: string | null;
  readonly garantieMois: number | null;
  readonly garantieKm: number | null;
}

/**
 * `PATCH /vehicules/{id}` restreint aux trois champs de garantie (issue #141) — même doctrine que
 * `useModifierEmplacementVehicule.ts` (hooks/vehicules/, importé ici en LECTURE, jamais modifié) :
 * un aide-mémoire de couverture posé par le vendeur quand il connaît l'information, PAS un
 * formulaire général de fiche. Le déclenchement AUTOMATIQUE de la garantie à la livraison d'un VN
 * (RV-54) est un chantier séparé, non tranché — ce hook n'écrit QUE ce que le vendeur saisit.
 *
 * `setQueryData` DIRECT sur `vehicules.detail` (la réponse complète `ReponseVehicule` est déjà
 * connue) + invalidation du PRÉFIXE `vehicules.liste` — même patron que
 * `useModifierEmplacementVehicule`. `ventes.suivi.liste` est ÉGALEMENT invalidé (préfixe large,
 * pas de clé précise disponible ici) : `CelluleGarantieSuivi` (ecrans/ventes/suivi/) lit ces mêmes
 * colonnes de `vehicule` via `GET /ventes/suivi` — sans cette invalidation, la colonne Garantie du
 * suivi resterait périmée après une saisie faite depuis la fiche stock.
 */
export function useModifierGarantieVehiculeStock(
  vehiculeId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseVehicule>,
  unknown,
  EntreeGarantieVehiculeStock
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeGarantieVehiculeStock) => modifierVehicule(vehiculeId, entree),
    onSuccess: async (reponse) => {
      queryClient.setQueryData(clesQuery.vehicules.detail(vehiculeId), reponse.donnees);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicules', 'liste'] }),
        queryClient.invalidateQueries({ queryKey: ['ventes', 'suivi'] }),
      ]);
    },
  });
}
