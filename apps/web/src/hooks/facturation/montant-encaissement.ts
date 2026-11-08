import type { MoyenPaiement } from '@dfa/shared';

/** Arrondi commercial au 5 centimes le plus proche (RF-49), dans les DEUX sens : un solde finissant
 *  par 1, 2, 6, 7 descend (le client paie moins), par 3, 4, 8, 9 monte (le client paie plus). Les
 *  restes 0..4 d'une division entière par 5 ne tombent jamais sur la demi-pièce : aucun cas
 *  d'égalité à trancher. Défini pour les montants positifs (un solde encaissable l'est toujours). */
export function arrondirA5Centimes(centimes: number): number {
  return Math.round(centimes / 5) * 5;
}

export interface MontantPourMoyen {
  /** Montant à remettre au comptoir (ou à débiter) pour ce moyen. */
  readonly montantCentimes: number;
  /** `montantCentimes - exactCentimes` : non nul uniquement pour des espèces arrondies. POSITIF
   *  quand le client remet PLUS que le solde (solde finissant par 3, 4, 8, 9), négatif quand il
   *  remet moins (1, 2, 6, 7). C'est le signe INVERSE de l'imputation `arrondi` de l'API
   *  (`exact - encaissé`) : voir `repartirImputations`. */
  readonly ecartArrondiCentimes: number;
}

/**
 * Montant à encaisser pour solder `exactCentimes` avec un moyen donné : seules les espèces sont
 * arrondies au 5 centimes (pas de pièce de 1 ou 2 ct) ; carte, TWINT, virement… paient au centime
 * près. Recalculé à CHAQUE changement de moyen à partir du montant exact — jamais depuis le montant
 * déjà arrondi, sinon 109.44 deviendrait 109.45 pour de bon.
 */
export function montantPourMoyen(exactCentimes: number, moyen: MoyenPaiement): MontantPourMoyen {
  if (moyen !== 'especes') return { montantCentimes: exactCentimes, ecartArrondiCentimes: 0 };
  const montantCentimes = arrondirA5Centimes(exactCentimes);
  return { montantCentimes, ecartArrondiCentimes: montantCentimes - exactCentimes };
}

export interface LigneEncaissement {
  readonly montantCentimes: number;
  /** `montantCentimes - exact` de la ligne (voir `MontantPourMoyen`), 0 ou `null` si aucun. */
  readonly ecartArrondiCentimes: number | null;
}

export interface FactureAImputer {
  readonly id: string;
  readonly soldeCentimes: number;
}

export interface ImputationEncaissement {
  readonly documentId: string;
  readonly montantCentimes: number;
  readonly nature: 'reglement' | 'arrondi';
}

/**
 * Répartit chaque ligne d'encaissement (un paiement par ligne, dans l'ordre) sur les factures
 * sélectionnées (ancienneté), en rendant EXACTEMENT ce que l'API attend (RF-49 → RF-52, CF-05).
 *
 *  - Le règlement imputé d'une ligne vaut les espèces réellement remises, jamais plus que le
 *    paiement (invariant MD-51.b) : aucun centime « orphelin » ne reste en avance client.
 *  - L'écart d'arrondi d'une ligne (espèces) devient une imputation `arrondi` SIGNÉE sur la
 *    dernière facture qu'elle solde : `-ecart`. Client qui remet 109.45 pour 109.44 : règlement
 *    10945 + arrondi -1. Client qui remet 109.40 pour 109.42 : règlement 10940 + arrondi +2.
 *  - Sans facture à solder entièrement par la ligne, l'écart n'est pas imputé (l'API le refuserait
 *    car l'arrondi ne se pose que sur l'encaissement qui solde).
 *  - Ce qui dépasse les soldes ouverts reste non imputé (trop-perçu réel = avance client).
 */
export function repartirImputations(
  lignes: readonly LigneEncaissement[],
  factures: readonly FactureAImputer[],
): ImputationEncaissement[][] {
  const capacites = factures.map((facture) => Math.max(facture.soldeCentimes, 0));

  return lignes.map((ligne) => {
    const ecart = ligne.ecartArrondiCentimes ?? 0;
    // Part du solde réellement éteinte par cette ligne : espèces remises moins l'écart d'arrondi.
    const exact = ligne.montantCentimes - ecart;
    const parts = new Array<number>(factures.length).fill(0);
    let reste = exact;
    let derniere = -1;
    capacites.forEach((capacite, index) => {
      const part = Math.min(capacite, reste);
      if (part <= 0) return;
      parts[index] = part;
      reste -= part;
      derniere = index;
    });

    const arrondiPosable =
      ecart !== 0 && reste === 0 && derniere >= 0 && capacites[derniere] === parts[derniere];
    if (!arrondiPosable && ecart !== 0) {
      // Pas de facture entièrement soldée par cette ligne : on impute les espèces telles quelles.
      return repartirSansArrondi(ligne.montantCentimes, factures, capacites);
    }

    const imputations: ImputationEncaissement[] = [];
    parts.forEach((part, index) => {
      const facture = factures[index];
      if (!facture || part <= 0) return;
      capacites[index] = (capacites[index] ?? 0) - part;
      const reglement = index === derniere && arrondiPosable ? part + ecart : part;
      if (reglement > 0) {
        imputations.push({
          documentId: facture.id,
          montantCentimes: reglement,
          nature: 'reglement',
        });
      }
    });
    const dernierDocument = factures[derniere];
    if (arrondiPosable && dernierDocument) {
      imputations.push({
        documentId: dernierDocument.id,
        montantCentimes: -ecart,
        nature: 'arrondi',
      });
    }
    return imputations;
  });
}

function repartirSansArrondi(
  montantCentimes: number,
  factures: readonly FactureAImputer[],
  capacites: number[],
): ImputationEncaissement[] {
  const imputations: ImputationEncaissement[] = [];
  let reste = montantCentimes;
  factures.forEach((facture, index) => {
    const part = Math.min(capacites[index] ?? 0, reste);
    if (part <= 0) return;
    capacites[index] = (capacites[index] ?? 0) - part;
    reste -= part;
    imputations.push({ documentId: facture.id, montantCentimes: part, nature: 'reglement' });
  });
  return imputations;
}

/**
 * Espèces saisies à la main qui ne sont pas un multiple de 5 centimes (aucune pièce de 1 ou 2 ct) :
 * rendu `true` -> la ligne est refusée à l'écran (comme par l'API), jamais corrigée en douce. Le
 * montant proposé (`arrondirA5Centimes`) est affiché dans le message.
 */
export function especesHorsCinqCentimes(moyen: MoyenPaiement, centimes: number | null): boolean {
  return moyen === 'especes' && centimes !== null && centimes > 0 && centimes % 5 !== 0;
}
