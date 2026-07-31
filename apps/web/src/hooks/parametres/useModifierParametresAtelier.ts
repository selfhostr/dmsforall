import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { schemaModificationParametresAtelier, type ReponseParametresAtelier } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

/** `EntreeModificationParametresAtelier` est déjà exporté par `@dfa/shared`, mais réaffirmé ici
 *  via `z.infer` du même schéma pour que ce fichier reste la seule source de la forme d'entrée
 *  côté mutation (cohérence avec `hooks/parametrage/taux-horaires.api.ts`). */
export type EntreeModificationParametresAtelier = z.infer<typeof schemaModificationParametresAtelier>;

async function modifierParametresAtelier(entree: EntreeModificationParametresAtelier): Promise<ReponseParametresAtelier> {
  const corps = schemaModificationParametresAtelier.parse(entree);
  const reponse = await requeteApi<ReponseParametresAtelier>('/parametres-atelier', {
    method: 'PATCH',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error('Réponse vide inattendue : PATCH /parametres-atelier.');
  return reponse;
}

/**
 * `PATCH /parametres-atelier` — singleton du tenant, modification PARTIELLE par domaine.
 * Un champ dont le drapeau de fonctionnalité est `false` au lot 1 (`facturation.*`, `planning.*`,
 * `reception.signature`, la plupart de `travaux.*`) renvoie `501 FONCTION_NON_DISPONIBLE` — voir
 * `apps/api/src/parametrage/parametres-atelier/gouvernance-fonctionnalites.ts`. L'écran
 * (`EcranParametrageAtelier`) n'envoie jamais ces champs-là : rien à absorber ici.
 *
 * Pose directement la réponse dans le cache (`setQueryData`, même geste que
 * `useModifierBlocCreancier`) : l'écran n'a jamais à relire après une écriture réussie.
 */
export function useModifierParametresAtelier(): UseMutationResult<
  ReponseParametresAtelier,
  unknown,
  EntreeModificationParametresAtelier
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeModificationParametresAtelier) => modifierParametresAtelier(entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesQuery.parametres.atelier(), reponse);
    },
  });
}
