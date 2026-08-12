import type { StatutSuiviStockArticle } from '@dfa/shared';

/**
 * Disponibilité d'une pièce du magasin — TROIS états qui ne se ressemblent jamais (rapport de
 * test terrain : « on ne sait pas », « il n'y en a aucune », « l'article n'est suivi nulle part »
 * ont été confondus, quatre défauts en une semaine) :
 *
 *  - `nonSuiviNullePart` : aucune ligne `stock_article` n'existe pour cet article, sur AUCUN site
 *    du tenant — jamais mis en stock. Distinct d'« aucune » : ce n'est pas épuisé, c'est
 *    littéralement jamais suivi.
 *  - `nonSuiviSurCeSite` : l'article EST suivi (au moins un autre site), mais pas à CELUI de l'OR
 *    — « on ne sait pas » pour ce site précisément, ni un stock nul ni une absence totale de suivi.
 *  - `aucune` : suivi à ce site, quantité disponible non positive — « il n'en reste aucun ».
 *  - `disponible` : quantité positive à ce site, portée telle quelle (millièmes).
 *
 * Dérivé DIRECTEMENT de `StatutSuiviStockArticle` (`@dfa/shared`, `contrats/pieces/stock.ts`) —
 * le champ serveur ajouté précisément pour cette confusion (voir son en-tête : « aucune ligne de
 * stock pour ce site » écrasait auparavant « stock réellement à zéro » derrière le même `0`).
 * `quantiteDisponibleMillieme` n'est FIABLE que lorsque `statutSuivi === 'suivi'` (contrat) — ce
 * module ne le lit donc jamais avant d'avoir vérifié `statutSuivi`.
 */
export type EtatDisponibilitePiece =
  | { readonly type: 'nonSuiviNullePart' }
  | { readonly type: 'nonSuiviSurCeSite' }
  | { readonly type: 'aucune' }
  | { readonly type: 'disponible'; readonly quantiteMillieme: number };

export function calculerDisponibilitePiece(
  statutSuivi: StatutSuiviStockArticle,
  quantiteDisponibleMillieme: number,
): EtatDisponibilitePiece {
  if (statutSuivi === 'nonSuiviNullePart') return { type: 'nonSuiviNullePart' };
  if (statutSuivi === 'nonSuiviSurCeSite') return { type: 'nonSuiviSurCeSite' };
  return quantiteDisponibleMillieme > 0
    ? { type: 'disponible', quantiteMillieme: quantiteDisponibleMillieme }
    : { type: 'aucune' };
}

/**
 * TTC (centimes) -> HT (centimes) au taux COURANT de l'article catalogue, arrondi au centime
 * (RM-01 : jamais de flottant conservé au-delà de ce calcul). Sert UNIQUEMENT à préremplir le prix
 * unitaire HT d'une ligne depuis un article choisi au magasin — un préremplissage MODIFIABLE, pas
 * une valeur transmise ni garantie identique au taux que le serveur figera réellement sur la ligne
 * (`ligne.ts`, `ReponseLigneOr.prixUnitaireCentimes`/`tauxTvaPourmille`, figés SERVEUR à la
 * création, RM-07 taux négocié client compris).
 *
 * NE JAMAIS recopier `ResultatRechercheComptoirArticle.prixVenteTtcCentimes` (TTC) directement
 * dans `prixUnitaireCentimes` (HT) — c'est exactement le défaut mesuré en test terrain (68.50
 * saisi, 74.05 affiché : une TVA ajoutée en trop sur un prix déjà TTC). Toujours passer par cette
 * conversion, jamais une copie brute.
 */
export function convertirTtcVersHtCentimes(ttcCentimes: number, tauxTvaPourmille: number): number {
  return Math.round((ttcCentimes * 1000) / (1000 + tauxTvaPourmille));
}
