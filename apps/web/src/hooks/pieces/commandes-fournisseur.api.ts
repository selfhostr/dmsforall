import type {
  EntreeAnnulationCommandeFournisseur,
  EntreeAnnulationReliquat,
  EntreeCreationCommandeFournisseur,
  EntreeReceptionCommandeFournisseur,
  FiltresCommandesFournisseur,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseCommandeFournisseur,
  ReponseReceptionCommandeFournisseur,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de la commande fournisseur (RP-26 → RP-31, §6.2) — même remarque d'écart que
 * `articles.api.ts` : les types consommés sont ceux de `@dfa/shared`, `api/types.gen.ts` n'a pas
 * encore été régénéré pour ce module. Les 7 routes existent et sont prouvées côté API
 * (`apps/api/src/pieces/commande-fournisseur.controller.ts`).
 *
 * PAS de `PATCH` générique sur `statut` (même patron que `document.ts`, facturation) : chaque
 * transition ci-dessous est une action nommée avec son propre corps.
 */

export interface PageCommandesFournisseur {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresListe(filtres: FiltresCommandesFournisseur, page: PageCommandesFournisseur): string {
  const parametres = new URLSearchParams();
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  if (filtres.fournisseurId) parametres.set('fournisseurId', filtres.fournisseurId);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.avecReliquat !== undefined) parametres.set('avecReliquat', String(filtres.avecReliquat));
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /commandes-fournisseur` — pagination par curseur. */
export async function listerCommandesFournisseur(
  filtres: FiltresCommandesFournisseur,
  page: PageCommandesFournisseur,
): Promise<PageCurseur<ReponseCommandeFournisseur>> {
  const reponse = await requeteApi<PageCurseur<ReponseCommandeFournisseur>>(
    `/commandes-fournisseur?${construireParametresListe(filtres, page)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /commandes-fournisseur/{id}` — fiche complète, lignes comprises. */
export async function recupererCommandeFournisseur(id: string): Promise<ReponseCommandeFournisseur> {
  const commande = await requeteApi<ReponseCommandeFournisseur>(`/commandes-fournisseur/${id}`, { method: 'GET' });
  if (!commande) {
    throw new Error('Réponse commande fournisseur inattendue : corps vide.');
  }
  return commande;
}

/** `POST /commandes-fournisseur` — `Idempotency-Key` OBLIGATOIRE (création sensible). Statut
 *  initial toujours `brouillon`. */
export async function creerCommandeFournisseur(
  entree: EntreeCreationCommandeFournisseur,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseCommandeFournisseur>>('/commandes-fournisseur', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /commandes-fournisseur.');
  }
  return reponse;
}

/** `POST /commandes-fournisseur/{id}/envoyer` — `brouillon → envoyee` (§6.2). Aucun corps, pas
 *  d'`Idempotency-Key` (transition gardée par l'état de départ). */
export async function envoyerCommandeFournisseur(id: string): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseCommandeFournisseur>>(`/commandes-fournisseur/${id}/envoyer`, {
    method: 'POST',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /commandes-fournisseur/envoyer.');
  }
  return reponse;
}

/** `POST /commandes-fournisseur/{id}/reception` — `Idempotency-Key` OBLIGATOIRE (génère un ou
 *  plusieurs mouvements `entree_livraison`). Le magasinier saisit ce qui est EFFECTIVEMENT livré
 *  (§7.4), pas ce qui était commandé. */
export async function receptionnerCommandeFournisseur(
  id: string,
  entree: EntreeReceptionCommandeFournisseur,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseReceptionCommandeFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReceptionCommandeFournisseur>>(
    `/commandes-fournisseur/${id}/reception`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /commandes-fournisseur/reception.');
  }
  return reponse;
}

/** `POST /commandes-fournisseur/{id}/lignes/{ligneId}/annuler-reliquat` — solde un reliquat SANS
 *  livraison, motif obligatoire (RP-28). */
export async function annulerReliquatLigneCommande(
  id: string,
  ligneId: string,
  entree: EntreeAnnulationReliquat,
): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseCommandeFournisseur>>(
    `/commandes-fournisseur/${id}/lignes/${ligneId}/annuler-reliquat`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /commandes-fournisseur/annuler-reliquat.');
  }
  return reponse;
}

/** `POST /commandes-fournisseur/{id}/annuler` — annule la commande ENTIÈRE, motif obligatoire.
 *  Uniquement depuis `brouillon`/`envoyee`, avant toute réception (§6.2). */
export async function annulerCommandeFournisseur(
  id: string,
  entree: EntreeAnnulationCommandeFournisseur,
): Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseCommandeFournisseur>>(`/commandes-fournisseur/${id}/annuler`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /commandes-fournisseur/annuler.');
  }
  return reponse;
}
