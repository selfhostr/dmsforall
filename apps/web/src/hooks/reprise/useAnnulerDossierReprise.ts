import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { EntreeAnnulationDossierReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { annulerDossier } from './reprise.api';

/** `POST /reprise/dossiers/{id}/annuler` — geste volontaire, motif requis (`schemaMotif`, 3-500
 *  caractères). Invalide la liste des dossiers : le statut `annule` fait basculer l'écran vers
 *  l'état dédié (`dossierAnnule`), sans jamais effacer l'historique. */
export function useAnnulerDossierReprise(dossierId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entree: EntreeAnnulationDossierReprise) =>
      annulerDossier(dossierId as string, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesReprise.dossiers.liste() });
    },
  });
}
