import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseAvecAvertissements, ReponseOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { modifierOrdreReparation } from './ordres-reparation.api';

interface VariablesPo {
  readonly numeroCommandeInterne: string;
  /** `ReponseOrdreReparation.version` lue au moment du clic (`If-Match`). */
  readonly version: number;
}

/** « Renseigner le n° de commande » (action proposée `RENSEIGNER_PO`) : `PATCH
 *  /ordres-reparation/{id}` avec le seul champ `numeroCommandeInterne`. */
export function useRenseignerPoOr(
  orId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseOrdreReparation>, unknown, VariablesPo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ numeroCommandeInterne, version }: VariablesPo) =>
      modifierOrdreReparation(
        orId,
        { numeroCommandeInterne: numeroCommandeInterne.trim() },
        version,
      ),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.or.detail(orId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
    },
  });
}
