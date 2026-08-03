import type {
  EntreeModificationStockSite,
  LigneReapprovisionnement,
  PageCurseur,
  ReponseDisponibiliteArticle,
  ReponseStockArticle,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** Couche transport du stock par site (RP-09 → RP-15) — même remarque d'écart que
 *  `articles.api.ts` (types `@dfa/shared`, `api/types.gen.ts` pas encore régénéré pour `pieces`). */

/** `GET /articles/{id}/disponibilite?siteId=` — RP-14/RP-19, LE terrain de CP-02 : nomme les
 *  réservations actives une par une. */
export async function recupererDisponibiliteArticle(articleId: string, siteId: string): Promise<ReponseDisponibiliteArticle> {
  const parametres = new URLSearchParams({ siteId });
  const reponse = await requeteApi<ReponseDisponibiliteArticle>(`/articles/${articleId}/disponibilite?${parametres.toString()}`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse disponibilité inattendue : corps vide.');
  }
  return reponse;
}

/** `PATCH /articles/{id}/stock/{siteId}` — réglages de site (emplacement, seuils), JAMAIS la
 *  quantité physique (RP-16 → RP-18 : elle ne bouge que par mouvement tracé). */
export async function modifierStockSite(
  articleId: string,
  siteId: string,
  entree: EntreeModificationStockSite,
): Promise<ReponseStockArticle> {
  const reponse = await requeteApi<ReponseStockArticle>(`/articles/${articleId}/stock/${siteId}`, {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /articles/stock.');
  }
  return reponse;
}

export interface FiltresReapprovisionnementListe {
  readonly siteId: string;
  readonly tri: string;
  readonly [cle: string]: string | number | boolean | undefined;
}

export interface PageReapprovisionnement {
  readonly limite: number;
  readonly curseur?: string;
}

/** `GET /stock/reapprovisionnement?siteId=` (RP-12) — propose, ne commande jamais
 *  automatiquement. */
export async function listerReapprovisionnement(
  filtres: FiltresReapprovisionnementListe,
  page: PageReapprovisionnement,
): Promise<PageCurseur<LigneReapprovisionnement>> {
  const parametres = new URLSearchParams({ siteId: filtres.siteId, tri: filtres.tri, limite: String(page.limite) });
  if (page.curseur) parametres.set('curseur', page.curseur);
  const reponse = await requeteApi<PageCurseur<LigneReapprovisionnement>>(`/stock/reapprovisionnement?${parametres.toString()}`, {
    method: 'GET',
  });
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}
