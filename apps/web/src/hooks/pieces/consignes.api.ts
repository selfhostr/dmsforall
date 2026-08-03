import type { FiltresConsignes, PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de la consigne d'échange standard (RP-37 → RP-42, §6.4) — même remarque
 * d'écart que `articles.api.ts`. Aucune création ici : une consigne naît toujours comme effet de
 * bord de la réalisation d'une ligne d'OR de dépose (module atelier, hors périmètre — voir
 * `consigne.ts`, @dfa/shared).
 */

export interface PageConsignes {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresListe(filtres: FiltresConsignes, page: PageConsignes): string {
  const parametres = new URLSearchParams();
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.ancienneteJoursMin !== undefined) parametres.set('ancienneteJoursMin', String(filtres.ancienneteJoursMin));
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /consignes` — §7.7 : « une consigne jamais rendue est de l'argent qui dort ». */
export async function listerConsignes(
  filtres: FiltresConsignes,
  page: PageConsignes,
): Promise<PageCurseur<ReponseConsigneEchangeStandard>> {
  const reponse = await requeteApi<PageCurseur<ReponseConsigneEchangeStandard>>(`/consignes?${construireParametresListe(filtres, page)}`, {
    method: 'GET',
  });
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `POST /consignes/{id}/marquer-retour-fournisseur` — le client ramène la vieille pièce (RP-40).
 *  Pas d'`Idempotency-Key` : transition gardée par l'état de départ. */
export async function marquerRetourFournisseurConsigne(id: string): Promise<ReponseConsigneEchangeStandard> {
  const reponse = await requeteApi<ReponseConsigneEchangeStandard>(`/consignes/${id}/marquer-retour-fournisseur`, {
    method: 'POST',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /consignes/marquer-retour-fournisseur.');
  }
  return reponse;
}
