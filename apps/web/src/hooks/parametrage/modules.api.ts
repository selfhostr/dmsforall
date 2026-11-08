import type { EntreeModificationModules, ReponseModules } from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { exigerCorps } from './support';

export type { EntreeModificationModules, ReponseModules };

/** `GET /parametres-entreprise/modules` — modules retirés par le garage et modules actifs. */
export async function recupererModules(): Promise<ReponseModules> {
  const reponse = await requeteApi<ReponseModules>('/parametres-entreprise/modules', {
    method: 'GET',
  });
  return exigerCorps(reponse, 'GET /parametres-entreprise/modules');
}

/** `PATCH /parametres-entreprise/modules` — la liste COMPLÈTE des modules retirés. */
export async function modifierModules(entree: EntreeModificationModules): Promise<ReponseModules> {
  const reponse = await requeteApi<ReponseModules>('/parametres-entreprise/modules', {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  return exigerCorps(reponse, 'PATCH /parametres-entreprise/modules');
}
