import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { schemaModificationParametresAtelier, type ReponseParametresAtelier } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';
import { ErreurApi } from '@/api/erreurs';

/** `EntreeModificationParametresAtelier` est déjà exporté par `@dfa/shared`, mais réaffirmé ici
 *  via `z.infer` du même schéma pour que ce fichier reste la seule source de la forme d'entrée
 *  côté mutation (cohérence avec `hooks/parametrage/taux-horaires.api.ts`). */
export type EntreeModificationParametresAtelier = z.infer<
  typeof schemaModificationParametresAtelier
>;

/**
 * `safeParse`, jamais `parse` : un corps qui viole encore le schéma après construction par l'écran
 * (cas normal — voir `EcranParametrageAtelier.versEntreeModification`, qui documente pourquoi
 * certains champs restent omis plutôt que garantis valides) ne doit JAMAIS planter en `Error` brute
 * que `messageErreur` ne sait pas traduire (elle retombait sur le bandeau générique « Une erreur
 * s'est produite. Réessayez. » — un mensonge pour une violation de validation que réessayer ne
 * corrige jamais). En cas d'échec, reconstruit une `ErreurApi` avec le code `VALIDATION_ECHOUEE` et
 * un `erreurs[]` dans le MÊME format que celui que le serveur produirait pour la même violation
 * (`apps/api/src/common/validation/pipe-zod.ts` : `champ` = chemin pointé façon `or.prefixe`,
 * `code`/`message` natifs zod) — l'écran affiche alors le message SOUS le champ fautif via
 * `ErreurApi.champErreur`/`messageErreurChamp`, exactement comme il le ferait pour un vrai `400`
 * serveur. Reste une validation CÔTÉ CLIENT (aucune requête envoyée pour un corps déjà invalide,
 * comportement inchangé) — un filet, pas un remplacement du contrôle serveur.
 */
async function modifierParametresAtelier(
  entree: EntreeModificationParametresAtelier,
): Promise<ReponseParametresAtelier> {
  const resultat = schemaModificationParametresAtelier.safeParse(entree);
  if (!resultat.success) {
    throw new ErreurApi({
      type: 'https://docs.dmsforall.example/erreurs/VALIDATION_ECHOUEE',
      title: 'Requête invalide',
      status: 400,
      code: 'VALIDATION_ECHOUEE',
      instance: '',
      erreurs: resultat.error.issues.map((issue) => ({
        champ: issue.path.length > 0 ? issue.path.join('.') : '(racine)',
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  const reponse = await requeteApi<ReponseParametresAtelier>('/parametres-atelier', {
    method: 'PATCH',
    body: JSON.stringify(resultat.data),
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
