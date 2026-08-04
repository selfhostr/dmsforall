import type {
  EntreeCreationAjustementInventaire,
  EntreeCreationMouvementCasse,
  EntreeCreationMouvementPerte,
  EntreeCreationMouvementTransfert,
  EntreeCreationRetourFournisseur,
  FiltresMouvementsStock,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseMouvementStock,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** Couche transport des mouvements de stock (RP-16 → RP-18) — IMMUABLE côté serveur (aucun
 *  `PATCH`/`DELETE` dans ce contrat), même remarque d'écart que `articles.api.ts`. */

export interface PageMouvements {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresMouvements(
  filtres: FiltresMouvementsStock,
  page: PageMouvements,
): string {
  const parametres = new URLSearchParams();
  for (const valeur of filtres.type ?? []) parametres.append('type', valeur);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.dateDe) parametres.set('dateDe', filtres.dateDe);
  if (filtres.dateA) parametres.set('dateA', filtres.dateA);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /articles/{id}/mouvements` — historique complet, paginé par curseur. */
export async function listerMouvementsArticle(
  articleId: string,
  filtres: FiltresMouvementsStock,
  page: PageMouvements,
): Promise<PageCurseur<ReponseMouvementStock>> {
  const reponse = await requeteApi<PageCurseur<ReponseMouvementStock>>(
    `/articles/${articleId}/mouvements?${construireParametresMouvements(filtres, page)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `POST /articles/{id}/mouvements/casse` — `Idempotency-Key` OBLIGATOIRE. */
export async function creerMouvementCasse(
  articleId: string,
  entree: EntreeCreationMouvementCasse,
  idempotencyKey: string,
): Promise<ReponseMouvementStock> {
  const reponse = await requeteApi<ReponseMouvementStock>(
    `/articles/${articleId}/mouvements/casse`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/mouvements/casse.');
  }
  return reponse;
}

/** `POST /articles/{id}/mouvements/perte` — `Idempotency-Key` OBLIGATOIRE. */
export async function creerMouvementPerte(
  articleId: string,
  entree: EntreeCreationMouvementPerte,
  idempotencyKey: string,
): Promise<ReponseMouvementStock> {
  const reponse = await requeteApi<ReponseMouvementStock>(
    `/articles/${articleId}/mouvements/perte`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/mouvements/perte.');
  }
  return reponse;
}

/** `POST /articles/{id}/mouvements/transfert` — un mouvement UNIQUE (RP-13), `Idempotency-Key`
 *  OBLIGATOIRE. */
export async function creerMouvementTransfert(
  articleId: string,
  entree: EntreeCreationMouvementTransfert,
  idempotencyKey: string,
): Promise<ReponseMouvementStock> {
  const reponse = await requeteApi<ReponseMouvementStock>(
    `/articles/${articleId}/mouvements/transfert`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/mouvements/transfert.');
  }
  return reponse;
}

/** `POST /articles/{id}/mouvements/ajustement-inventaire` — `Idempotency-Key` OBLIGATOIRE. Le
 *  client envoie la quantité COMPTÉE (§7.6), jamais un delta. `donnees: null` si le compte
 *  correspond déjà au stock physique (aucun mouvement créé). */
export async function creerAjustementInventaire(
  articleId: string,
  entree: EntreeCreationAjustementInventaire,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseMouvementStock | null>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseMouvementStock | null>>(
    `/articles/${articleId}/mouvements/ajustement-inventaire`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/mouvements/ajustement-inventaire.');
  }
  return reponse;
}

/** `POST /articles/{id}/mouvements/retour-fournisseur` — `Idempotency-Key` OBLIGATOIRE. */
export async function creerRetourFournisseur(
  articleId: string,
  entree: EntreeCreationRetourFournisseur,
  idempotencyKey: string,
): Promise<ReponseMouvementStock> {
  const reponse = await requeteApi<ReponseMouvementStock>(
    `/articles/${articleId}/mouvements/retour-fournisseur`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/mouvements/retour-fournisseur.');
  }
  return reponse;
}
