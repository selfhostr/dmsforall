import type { DocumentVenteResume } from '@dfa/shared';

/**
 * Sélection du « prix » affiché en tête de fiche (design §7.1, littéral) : le dossier de vente ne
 * porte structurellement AUCUN montant (`contrats/ventes/dossier-vente.ts` §8.2 : « aucune
 * duplication du montant, de la TVA ou du statut de paiement ici ») — ce prix vient TOUJOURS de
 * `documents` (`DocumentVenteResume[]`, embarqués en lecture), jamais recalculé ici.
 *
 * Règle, dans l'ordre :
 *  1. Le document le plus récent (`dateDocument` desc) de type `bon_commande` ou `facture`, dans
 *     un statut de COMMITMENT réel — NI `brouillon` NI `abandonne` (jamais communiqués au client :
 *     `STATUTS_DOCUMENT_VENTE`, `contrats/facturation/enums.ts`, n'atteint les deux QUE depuis
 *     `brouillon`, jamais après `emis`) NI `annule` NI `remplace` — porte le prix « engagé »
 *     (contractuel).
 *
 *     BUG CORRIGÉ (mesuré en navigateur, dossier avec un bon de commande `brouillon` jamais
 *     rempli) : un `brouillon` n'exclu pas jusqu'ici laissait passer un `totalTtcCentimes` de `0`
 *     — la SOMME D'AUCUNE LIGNE, pas un prix — rendu aussi affirmativement qu'un vrai montant
 *     (« CHF 0.00 » en gras, alors que le même véhicule affiche CHF 21'900.00 sur `/ventes/stock`).
 *     Un `brouillon`/`abandonne` n'est structurellement JAMAIS un engagement, quel que soit son
 *     total : ce n'est pas son montant qui est en cause, c'est son statut — voir 2. ci-dessous pour
 *     le cas où il porte quand même une information utile.
 *  2. À défaut, le document le plus récent parmi :
 *       - un `devis`, NI `annule` NI `refuse` NI `expire` NI `abandonne` ;
 *       - un `bon_commande`/`facture` encore `brouillon` MAIS avec un total SIGNIFICATIF (défini
 *         ET strictement positif — voir `aUnTotalSignificatif`) : une saisie déjà avancée porte une
 *         indication utile au vendeur, à condition de ne jamais se faire passer pour un engagement.
 *     Porte un prix INDICATIF (l'écran doit le rendre atténué, préfixe « Indicatif »).
 *  3. À défaut, aucun prix : `{ statut: 'aucun' }`.
 *
 * `totalTtcCentimes` peut être ABSENT sur le document choisi (rôle sans droit aux montants,
 * `facturation.document.lire_montants` — voir `versDocumentVenteResume`) : ce module ne le
 * substitue jamais par `0`, l'appelant doit composer sur `document.totalTtcCentimes !== undefined`
 * exactement comme `EcranListeOrdresReparation` le fait pour `totalTtcCentimes`. C'est un cas
 * DIFFÉRENT d'un total réellement nul (`0`, défini) : « on ne sait pas » (rôle masqué) et « c'est
 * zéro » (aucune ligne, ou prix réellement nul) ne partagent jamais le même rendu — voir
 * `aUnTotalSignificatif`, qui distingue explicitement les deux plutôt que de les confondre sous un
 * seul test de vérité JavaScript (`0` est falsy, `undefined` aussi : jamais `if (montant)`).
 */
export type PrixDossierVente =
  | { readonly statut: 'aucun' }
  | { readonly statut: 'engage'; readonly document: DocumentVenteResume }
  | { readonly statut: 'indicatif'; readonly document: DocumentVenteResume };

const STATUTS_EXCLUS_ENGAGE = new Set(['brouillon', 'abandonne', 'annule', 'remplace']);
const STATUTS_EXCLUS_DEVIS = new Set(['annule', 'refuse', 'expire', 'abandonne']);

function plusRecent(documents: readonly DocumentVenteResume[]): DocumentVenteResume | undefined {
  return [...documents].sort((a, b) => (a.dateDocument < b.dateDocument ? 1 : -1))[0];
}

/**
 * `true` seulement si `totalTtcCentimes` est une valeur RÉELLE et non nulle. `undefined` (rôle
 * masqué) et `0` (aucune ligne, ou total réellement nul) sont TOUS LES DEUX exclus ici — délibéré,
 * voir le commentaire de tête de ce fichier : cette fonction sert uniquement à décider si un
 * document encore `brouillon` porte une indication digne d'être montrée, jamais à décider si un
 * montant doit être AFFICHÉ (ça, c'est `document.totalTtcCentimes !== undefined`, à l'appelant).
 */
function aUnTotalSignificatif(document: DocumentVenteResume): boolean {
  return document.totalTtcCentimes !== undefined && document.totalTtcCentimes > 0;
}

export function selectionnerPrixDossierVente(
  documents: readonly DocumentVenteResume[],
): PrixDossierVente {
  const candidatsEngages = documents.filter(
    (d) =>
      (d.typeDocument === 'bon_commande' || d.typeDocument === 'facture') &&
      !STATUTS_EXCLUS_ENGAGE.has(d.statut),
  );
  const engage = plusRecent(candidatsEngages);
  if (engage) return { statut: 'engage', document: engage };

  const candidatsIndicatifs = documents.filter(
    (d) =>
      (d.typeDocument === 'devis' && !STATUTS_EXCLUS_DEVIS.has(d.statut)) ||
      ((d.typeDocument === 'bon_commande' || d.typeDocument === 'facture') &&
        d.statut === 'brouillon' &&
        aUnTotalSignificatif(d)),
  );
  const indicatif = plusRecent(candidatsIndicatifs);
  if (indicatif) return { statut: 'indicatif', document: indicatif };

  return { statut: 'aucun' };
}
