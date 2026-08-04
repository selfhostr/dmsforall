import type { DocumentVenteResume } from '@dfa/shared';

/**
 * Sélection du « prix » affiché en tête de fiche (design §7.1, littéral) : le dossier de vente ne
 * porte structurellement AUCUN montant (`contrats/ventes/dossier-vente.ts` §8.2 : « aucune
 * duplication du montant, de la TVA ou du statut de paiement ici ») — ce prix vient TOUJOURS de
 * `documents` (`DocumentVenteResume[]`, embarqués en lecture), jamais recalculé ici.
 *
 * Règle, dans l'ordre :
 *  1. Le document le plus récent (`dateDocument` desc) de type `bon_commande` ou `facture`, dans
 *     un statut NI `annule` NI `remplace` — porte le prix « engagé » (contractuel).
 *  2. À défaut, le `devis` le plus récent, NI `annule` NI `refuse` NI `expire` — porte un prix
 *     INDICATIF (l'écran doit le rendre atténué, préfixe « Indicatif »).
 *  3. À défaut, aucun prix : `{ statut: 'aucun' }`.
 *
 * `totalTtcCentimes` peut être ABSENT sur le document choisi (rôle sans droit aux montants,
 * `facturation.document.lire_montants` — voir `versDocumentVenteResume`) : ce module ne le
 * substitue jamais par `0`, l'appelant doit composer sur `document.totalTtcCentimes !== undefined`
 * exactement comme `EcranListeOrdresReparation` le fait pour `totalTtcCentimes`.
 */
export type PrixDossierVente =
  | { readonly statut: 'aucun' }
  | { readonly statut: 'engage'; readonly document: DocumentVenteResume }
  | { readonly statut: 'indicatif'; readonly document: DocumentVenteResume };

const STATUTS_EXCLUS_ENGAGE = new Set(['annule', 'remplace']);
const STATUTS_EXCLUS_DEVIS = new Set(['annule', 'refuse', 'expire']);

function plusRecent(documents: readonly DocumentVenteResume[]): DocumentVenteResume | undefined {
  return [...documents].sort((a, b) => (a.dateDocument < b.dateDocument ? 1 : -1))[0];
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

  const candidatsDevis = documents.filter(
    (d) => d.typeDocument === 'devis' && !STATUTS_EXCLUS_DEVIS.has(d.statut),
  );
  const devis = plusRecent(candidatsDevis);
  if (devis) return { statut: 'indicatif', document: devis };

  return { statut: 'aucun' };
}
