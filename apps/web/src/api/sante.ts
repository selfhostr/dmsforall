import { requeteApi } from './client';
import type { components } from './types.gen';

/** `GET /api/v1/sante` — endpoint public (sonde de vie), sans équivalent dans `@dfa/shared` :
 *  aucun autre écran de l'app ne consomme cette ressource, donc pas de type dédié à faire vivre
 *  côté partagé pour un unique champ. Le type OpenAPI généré (`types.gen.ts`) est la source
 *  correcte ici — jamais une redéfinition manuelle (voir en-tête de fichier des autres modules
 *  `api/`). */
export type ReponseSante = components['schemas']['SanteDto'];

/** Utilisée uniquement pour afficher `version` en bas de la barre latérale
 *  (`composants/layout/BarreLaterale.tsx`) — voir `useVersionApplication`. */
export async function recupererSante(): Promise<ReponseSante> {
  const reponse = await requeteApi<ReponseSante>('/sante', { method: 'GET' });
  if (!reponse) {
    throw new Error('Réponse de sonde de vie inattendue : corps vide.');
  }
  return reponse;
}
