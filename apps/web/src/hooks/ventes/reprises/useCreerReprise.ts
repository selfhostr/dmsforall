import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationReprise, ReponseAvecAvertissements, ReponseReprise } from '@dfa/shared';

import { clesVentesReprises } from './cles';
import { creerReprise } from './reprise.api';

interface VariablesCreationReprise {
  readonly entree: EntreeCreationReprise;
  readonly idempotencyKey: string;
}

/** `POST /dossiers-vente/{id}/reprise` — pose directement la reprise créée dans le cache (jamais
 *  de relecture). Le dossier parent embarque un `RepriseResume` (`dossier.reprise`) qui reste
 *  périmé tant que sa propre requête n'est pas invalidée/rechargée : c'est la responsabilité de
 *  l'écran appelant (fiche dossier, hors périmètre de ce module) — voir `CarteReprise.onMutationReussie`. */
export function useCreerReprise(
  dossierVenteId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseReprise>, unknown, VariablesCreationReprise> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationReprise) =>
      creerReprise(dossierVenteId, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesReprises.detail(dossierVenteId), reponse.donnees);
    },
  });
}
