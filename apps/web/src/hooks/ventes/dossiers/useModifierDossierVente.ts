import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeModificationDossierVente,
  ReponseAvecAvertissements,
  ReponseDossierVente,
} from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import { modifierDossierVente } from './dossiers-vente.api';

interface VariablesModificationDossierVente {
  readonly id: string;
  readonly entree: EntreeModificationDossierVente;
  /** `` `W/"${dossier.version}"` `` — même patron que `useModifierDocumentVente` /
   *  `EcranFicheFacture.tsx`, construit par l'appelant depuis la ressource déjà chargée. */
  readonly etag: string | null;
}

/** `PATCH /dossiers-vente/{id}` — pose directement le dossier renvoyé dans le cache (jamais de
 *  relecture). Réassignation du véhicule refusée par le serveur au-delà de `prospection`
 *  (`409 VENTE_DOSSIER_TRANSITION_INTERDITE`, RV-30) — l'écran affiche ce refus via `RefusBloquant`,
 *  ce hook ne le devine pas. */
export function useModifierDossierVente(): UseMutationResult<
  ReponseAvecAvertissements<ReponseDossierVente>,
  unknown,
  VariablesModificationDossierVente
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree, etag }: VariablesModificationDossierVente) =>
      modifierDossierVente(id, entree, etag),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesDossiers.detail(reponse.donnees.id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['ventes', 'dossiers', 'liste'] });
    },
  });
}
