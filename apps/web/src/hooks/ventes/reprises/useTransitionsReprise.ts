import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeActionConfirmerReprise,
  EntreeActionNegocierReprise,
  EntreeActionRefuserReprise,
  EntreeModificationReprise,
  ReponseAvecAvertissements,
  ReponseReprise,
} from '@dfa/shared';

import { clesVentesReprises } from './cles';
import { confirmerReprise, modifierReprise, negocierReprise, refuserReprise } from './reprise.api';

/**
 * Une mutation par action nommée sur une reprise — même patron que
 * `hooks/pieces/useTransitionsArticle.ts` : chaque action renvoie la reprise COMPLÈTE, posée
 * directement dans le cache (jamais de relecture).
 *
 * Aucune de ces mutations n'invalide/ne réécrit `dossier.reprise` (le `RepriseResume` embarqué
 * dans `ReponseDossierVente`, propriété de la fiche dossier, hors périmètre de ce module) : c'est
 * à l'écran intégrateur d'invalider sa propre requête dossier en réaction — voir
 * `CarteReprise.onMutationReussie`, composé au niveau de chaque `mutate(..., { onSuccess })`.
 */
function useActionReprise<TEntree>(
  dossierVenteId: string,
  action: (
    dossierVenteId: string,
    entree: TEntree,
  ) => Promise<ReponseAvecAvertissements<ReponseReprise>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseReprise>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(dossierVenteId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesReprises.detail(dossierVenteId), reponse.donnees);
    },
  });
}

interface VariablesModificationReprise {
  readonly entree: EntreeModificationReprise;
  readonly etag: string;
}

/** `PATCH /dossiers-vente/{id}/reprise` — `If-Match` obligatoire, révision de la valeur estimée
 *  tant que `statut = estimee` (RV-27). */
export function useModifierReprise(
  dossierVenteId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseReprise>,
  unknown,
  VariablesModificationReprise
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, etag }: VariablesModificationReprise) =>
      modifierReprise(dossierVenteId, entree, etag),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesReprises.detail(dossierVenteId), reponse.donnees);
    },
  });
}

/** `POST /dossiers-vente/{id}/reprise/negocier` — rejouable tant que non confirmée/refusée
 *  (RV-06 : chaque appel un événement audité). */
export function useNegocierReprise(dossierVenteId: string) {
  return useActionReprise<EntreeActionNegocierReprise>(dossierVenteId, negocierReprise);
}

/** `POST /dossiers-vente/{id}/reprise/confirmer` — correction exceptionnelle, motif obligatoire. */
export function useConfirmerReprise(dossierVenteId: string) {
  return useActionReprise<EntreeActionConfirmerReprise>(dossierVenteId, confirmerReprise);
}

/** `POST /dossiers-vente/{id}/reprise/refuser` — motif obligatoire (RV-25). */
export function useRefuserReprise(dossierVenteId: string) {
  return useActionReprise<EntreeActionRefuserReprise>(dossierVenteId, refuserReprise);
}
