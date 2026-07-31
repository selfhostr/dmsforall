import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { schemaModificationParametresSite, type ReponseParametresSite } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

export type EntreeModificationParametresSite = z.infer<typeof schemaModificationParametresSite>;

interface VariablesModificationParametresSite {
  readonly siteId: string;
  readonly entree: EntreeModificationParametresSite;
}

async function modifierParametresSite(
  siteId: string,
  entree: EntreeModificationParametresSite,
): Promise<ReponseParametresSite> {
  const corps = schemaModificationParametresSite.parse(entree);
  const reponse = await requeteApi<ReponseParametresSite>(`/sites/${siteId}/parametres-atelier`, {
    method: 'PATCH',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : PATCH /sites/${siteId}/parametres-atelier.`);
  return reponse;
}

/** `PATCH /sites/{siteId}/parametres-atelier` (P-20 capacité, P-31 clôture pointage, horaires,
 *  jours de fermeture) — pose la réponse dans le cache du site modifié, même geste que
 *  `useModifierParametresAtelier`. */
export function useModifierParametresSite(): UseMutationResult<
  ReponseParametresSite,
  unknown,
  VariablesModificationParametresSite
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ siteId, entree }: VariablesModificationParametresSite) => modifierParametresSite(siteId, entree),
    onSuccess: (reponse, variables) => {
      queryClient.setQueryData(clesQuery.parametres.site(variables.siteId), reponse);
    },
  });
}
