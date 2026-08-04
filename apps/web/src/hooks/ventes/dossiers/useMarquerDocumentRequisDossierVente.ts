import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeMarquerDocumentRequis,
  ReponseAvecAvertissements,
  ReponseDossierVente,
} from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import { marquerDocumentRequisDossierVente } from './dossiers-vente.api';

/** `POST /dossiers-vente/{id}/documents-requis/marquer` — bascule légère (RV-35), pas de dialog
 *  (§7.6 du design) : l'échec doit être géré LOCALEMENT à la ligne par l'appelant (case qui revient
 *  à son état précédent), ce hook expose donc son `error`/`isPending` par item, jamais un état
 *  d'écran global. */
export function useMarquerDocumentRequisDossierVente(
  dossierVenteId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseDossierVente>,
  unknown,
  EntreeMarquerDocumentRequis
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeMarquerDocumentRequis) =>
      marquerDocumentRequisDossierVente(dossierVenteId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesDossiers.detail(dossierVenteId), reponse.donnees);
    },
  });
}
