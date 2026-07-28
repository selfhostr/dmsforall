import { TRI_DEFAUT_CREATION } from '@dfa/shared';
import { decoderCurseurTrie, encoderCurseurTrie } from '../../common/pagination';

/**
 * Pagination par défaut (`creeLe:desc`, keyset sur `(cree_le, id)`) pour les collections de
 * référentiels du lot 1 (taux horaires, prestations) — AUCUNE des deux n'est listée dans le
 * tableau normatif de tris/filtres de contrats-api-etape-1.md §6.2 (qui ne couvre que clients,
 * véhicules, RDV, OR, pointages, audit) ; §6.4 ne les liste pas non plus parmi les 3 exceptions
 * non paginées (recherche, `/parametres-atelier`, `contexte-atelier`). Elles restent donc des
 * COLLECTIONS au sens de la règle générale (§6.1) : curseur par défaut, sans tri alternatif tant
 * qu'aucun n'est documenté — inventer une liste de tris ici serait exactement le risque que §6.1
 * cherche à éviter (« un tri non listé produit 400, jamais un tri silencieusement ignoré »).
 */

export interface LigneAvecCreation {
  readonly creeLe: Date;
  readonly id: string;
}

/** Décode le curseur reçu, ou `null` en première page. Toujours contre `TRI_DEFAUT_CREATION`. */
export function decoderCurseurDefaut(curseur: string | undefined): { readonly creeLe: Date; readonly id: string } | null {
  if (!curseur) return null;
  const donnees = decoderCurseurTrie(curseur, TRI_DEFAUT_CREATION);
  return { creeLe: new Date(donnees.valeur as string), id: donnees.id };
}

/**
 * Découpe `limite + 1` lignes rendues par la requête (triée `cree_le desc, id desc`) en une page
 * de taille `limite` et un `curseurSuivant` — `null` si la ligne surnuméraire n'existait pas.
 */
export function pageDepuisLignes<T extends LigneAvecCreation>(
  lignes: readonly T[],
  limite: number,
): { readonly page: readonly T[]; readonly curseurSuivant: string | null } {
  const aSuite = lignes.length > limite;
  const page = aSuite ? lignes.slice(0, limite) : lignes;
  const dernier = page[page.length - 1];

  const curseurSuivant =
    aSuite && dernier
      ? encoderCurseurTrie({ tri: TRI_DEFAUT_CREATION, valeur: dernier.creeLe.toISOString(), id: dernier.id })
      : null;

  return { page, curseurSuivant };
}
