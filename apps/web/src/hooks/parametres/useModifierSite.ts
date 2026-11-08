import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { schemaModificationSite, type EntreeModificationSite, type SiteResume } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

interface VariablesModificationSite {
  readonly siteId: string;
  readonly entree: EntreeModificationSite;
}

/** `PATCH /sites/{siteId}` (code court). Rafraîchit la session : `session.sites` porte les codes
 *  courts affichés par tous les filtres de site. */
export function useModifierSite(): UseMutationResult<
  SiteResume,
  unknown,
  VariablesModificationSite
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ siteId, entree }: VariablesModificationSite) => {
      const corps = schemaModificationSite.parse(entree);
      const reponse = await requeteApi<SiteResume>(`/sites/${siteId}`, {
        method: 'PATCH',
        body: JSON.stringify(corps),
      });
      if (!reponse) throw new Error(`Réponse vide inattendue : PATCH /sites/${siteId}.`);
      return reponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.session() });
    },
  });
}
