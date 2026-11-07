import type {
  EntreeModificationParametresEntreprise,
  ReponseParametresEntreprise,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { exigerCorps } from './support';

export type { EntreeModificationParametresEntreprise, ReponseParametresEntreprise };

/** `GET /parametres-entreprise` — raison sociale (lecture seule) et n° TVA du garage. */
export async function recupererParametresEntreprise(): Promise<ReponseParametresEntreprise> {
  const reponse = await requeteApi<ReponseParametresEntreprise>('/parametres-entreprise', {
    method: 'GET',
  });
  return exigerCorps(reponse, 'GET /parametres-entreprise');
}

/** `PATCH /parametres-entreprise` — `numeroTva: null` efface le numéro (non assujetti). */
export async function modifierParametresEntreprise(
  entree: EntreeModificationParametresEntreprise,
): Promise<ReponseParametresEntreprise> {
  const reponse = await requeteApi<ReponseParametresEntreprise>('/parametres-entreprise', {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  return exigerCorps(reponse, 'PATCH /parametres-entreprise');
}
