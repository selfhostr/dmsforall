/**
 * Passage de la liste de réapprovisionnement (`EcranReapprovisionnement`) vers la création d'une
 * commande fournisseur (`EcranNouvelleCommandeFournisseur`) — état de navigation React Router
 * (`navigate(chemin, { state })`), PAS des paramètres d'URL : mécanisme déjà en usage ailleurs
 * dans ce dépôt pour transmettre des données structurées entre deux écrans sans les exposer dans
 * l'URL (voir `useLocation().state` dans les écrans qui en dépendent), plus simple ici qu'une
 * ribambelle de paramètres de requête pour un tableau de lignes de longueur variable.
 *
 * `fournisseurId` ABSENT délibérément : `LigneReapprovisionnement` (`contrats/pieces/stock.ts`)
 * ne porte aucune information de fournisseur — la déterminer demanderait un aller-retour
 * `GET /articles/{id}` par article sélectionné. `EcranNouvelleCommandeFournisseur` tente cette
 * détection lui-même, à la réception de cet état (voir son commentaire de tête), plutôt que de
 * l'inventer ici sans donnée fiable.
 */
export interface LignePreremplissageCommande {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  /** Millièmes d'unité, jamais un flottant intermédiaire — même doctrine que
   *  `quantiteMillieme` (`contrats/pieces/primitives.ts`). */
  readonly quantiteSuggereeMillieme: number;
}

export interface EtatPreremplissageCommandeFournisseur {
  readonly siteId: string;
  readonly lignes: readonly LignePreremplissageCommande[];
}

/** Garde de type sur `useLocation().state` — non typé par React Router (`unknown`), et perdu
 *  (redevient `undefined`) sur un rechargement complet de page ou un lien direct vers cette route :
 *  `EcranNouvelleCommandeFournisseur` doit rester utilisable SANS pré-remplissage dans ce cas,
 *  jamais planter sur une forme inattendue. */
export function estEtatPreremplissageValide(
  valeur: unknown,
): valeur is EtatPreremplissageCommandeFournisseur {
  return (
    typeof valeur === 'object' &&
    valeur !== null &&
    typeof (valeur as { siteId?: unknown }).siteId === 'string' &&
    Array.isArray((valeur as { lignes?: unknown }).lignes)
  );
}
