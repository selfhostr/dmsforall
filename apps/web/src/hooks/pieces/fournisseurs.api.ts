import type {
  EntreeCreationFournisseur,
  EntreeModificationFournisseur,
  FiltresFournisseurs,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseFournisseur,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du référentiel fournisseur (RP-26, §1) — même remarque d'écart que
 * `articles.api.ts`. Minimal par construction : nom, coordonnées, délai habituel. Pas de
 * `DELETE` : un fournisseur se désactive, jamais ne se supprime (RP-07/RM-12/RM-31).
 */

export interface PageFournisseurs {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresListe(filtres: FiltresFournisseurs, page: PageFournisseurs): string {
  const parametres = new URLSearchParams();
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /fournisseurs` — pagination par curseur. */
export async function listerFournisseurs(
  filtres: FiltresFournisseurs,
  page: PageFournisseurs,
): Promise<PageCurseur<ReponseFournisseur>> {
  const reponse = await requeteApi<PageCurseur<ReponseFournisseur>>(
    `/fournisseurs?${construireParametresListe(filtres, page)}`,
    {
      method: 'GET',
    },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /fournisseurs/{id}` — fiche fournisseur. */
export async function recupererFournisseur(id: string): Promise<ReponseFournisseur> {
  const fournisseur = await requeteApi<ReponseFournisseur>(`/fournisseurs/${id}`, {
    method: 'GET',
  });
  if (!fournisseur) {
    throw new Error('Réponse fournisseur inattendue : corps vide.');
  }
  return fournisseur;
}

/** `POST /fournisseurs` — pas d'`Idempotency-Key` (aucune numérotation serveur, un doublon de nom
 *  n'est pas une collision technique). */
export async function creerFournisseur(
  entree: EntreeCreationFournisseur,
): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFournisseur>>('/fournisseurs', {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /fournisseurs.');
  }
  return reponse;
}

/** `PATCH /fournisseurs/{id}` — mise à jour partielle. */
export async function modifierFournisseur(
  id: string,
  entree: EntreeModificationFournisseur,
): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFournisseur>>(
    `/fournisseurs/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /fournisseurs.');
  }
  return reponse;
}

/** `POST /fournisseurs/{id}/desactiver` — pas de suppression (RP-07/RM-12/RM-31). */
export async function desactiverFournisseur(
  id: string,
): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFournisseur>>(
    `/fournisseurs/${id}/desactiver`,
    {
      method: 'POST',
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /fournisseurs/desactiver.');
  }
  return reponse;
}

/** `POST /fournisseurs/{id}/reactiver` — retour à `actif`. */
export async function reactiverFournisseur(
  id: string,
): Promise<ReponseAvecAvertissements<ReponseFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFournisseur>>(
    `/fournisseurs/${id}/reactiver`,
    {
      method: 'POST',
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /fournisseurs/reactiver.');
  }
  return reponse;
}
