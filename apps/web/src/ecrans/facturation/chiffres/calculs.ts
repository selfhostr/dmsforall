import type {
  DocumentVenteResume,
  MoyenPaiement,
  OrdreReparationResume,
  ReponsePaiement,
} from '@dfa/shared';

export interface EncaissementMoyen {
  readonly moyen: MoyenPaiement;
  readonly centimes: number;
  readonly nombre: number;
}

/** Encaissements regroupés par moyen (signés : un remboursement vient en déduction), moyens sans
 *  mouvement omis, du plus gros au plus petit. */
export function encaissementsParMoyen(
  paiements: readonly Pick<ReponsePaiement, 'moyen' | 'montantCentimes'>[],
): { readonly parMoyen: readonly EncaissementMoyen[]; readonly totalCentimes: number } {
  const cumul = new Map<MoyenPaiement, { centimes: number; nombre: number }>();
  let totalCentimes = 0;
  for (const paiement of paiements) {
    const courant = cumul.get(paiement.moyen) ?? { centimes: 0, nombre: 0 };
    cumul.set(paiement.moyen, {
      centimes: courant.centimes + paiement.montantCentimes,
      nombre: courant.nombre + 1,
    });
    totalCentimes += paiement.montantCentimes;
  }
  const parMoyen = [...cumul.entries()]
    .map(([moyen, valeur]) => ({ moyen, ...valeur }))
    .sort((a, b) => b.centimes - a.centimes);
  return { parMoyen, totalCentimes };
}

export interface ResumeFacturesOuvertes {
  readonly nombreOuvertes: number;
  readonly soldeOuvertCentimes: number;
  readonly nombreEnRetard: number;
  readonly soldeEnRetardCentimes: number;
}

/** Factures émises encore dues : nombre et solde restant dû, dont la part en retard d'échéance. */
export function resumerFacturesOuvertes(
  factures: readonly Pick<DocumentVenteResume, 'soldeCentimes' | 'enRetard'>[],
): ResumeFacturesOuvertes {
  let soldeOuvertCentimes = 0;
  let nombreEnRetard = 0;
  let soldeEnRetardCentimes = 0;
  for (const facture of factures) {
    const solde = facture.soldeCentimes ?? 0;
    soldeOuvertCentimes += solde;
    if (facture.enRetard === true) {
      nombreEnRetard += 1;
      soldeEnRetardCentimes += solde;
    }
  }
  return {
    nombreOuvertes: factures.length,
    soldeOuvertCentimes,
    nombreEnRetard,
    soldeEnRetardCentimes,
  };
}

export interface ResumeOrTermines {
  readonly nombre: number;
  /** `null` = le rôle ne voit pas les montants (jamais un faux zéro). */
  readonly estimeTtcCentimes: number | null;
}

/** OR terminés, pas encore facturés : nombre et montant TTC estimé (somme des totaux d'OR). */
export function resumerOrTermines(
  ordres: readonly Pick<OrdreReparationResume, 'totalTtcCentimes'>[],
): ResumeOrTermines {
  const montantsVisibles = ordres.every((or) => or.totalTtcCentimes !== undefined);
  return {
    nombre: ordres.length,
    estimeTtcCentimes:
      montantsVisibles || ordres.length === 0
        ? ordres.reduce((somme, or) => somme + (or.totalTtcCentimes ?? 0), 0)
        : null,
  };
}
