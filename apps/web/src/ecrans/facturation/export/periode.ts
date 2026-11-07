/**
 * Périodes de l'export fiduciaire — fonctions pures, `maintenant` injecté (testable sans horloge).
 * Les dates sont des jours calendaires `aaaa-mm-jj` (ce que l'API attend : `schemaDateJour`),
 * calculées en heure LOCALE du poste : le « mois précédent » d'un garage suisse ne doit pas
 * basculer d'un jour à cause de l'UTC.
 */

export type ModePeriode = 'moisPrecedent' | 'trimestrePrecedent' | 'personnalisee';

export interface Periode {
  readonly du: string;
  readonly au: string;
}

function iso(annee: number, mois0: number, jour: number): string {
  const m = String(mois0 + 1).padStart(2, '0');
  const j = String(jour).padStart(2, '0');
  return `${String(annee).padStart(4, '0')}-${m}-${j}`;
}

/** Dernier jour du mois (`mois0` = 0..11). */
function dernierJour(annee: number, mois0: number): number {
  return new Date(annee, mois0 + 1, 0).getDate();
}

/** Mois civil complet qui précède celui de `maintenant`. */
export function periodeMoisPrecedent(maintenant: Date): Periode {
  const premier = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
  const annee = premier.getFullYear();
  const mois0 = premier.getMonth();
  return { du: iso(annee, mois0, 1), au: iso(annee, mois0, dernierJour(annee, mois0)) };
}

/** Trimestre civil complet qui précède celui de `maintenant`. */
export function periodeTrimestrePrecedent(maintenant: Date): Periode {
  const trimestreCourant = Math.floor(maintenant.getMonth() / 3);
  const debut = new Date(maintenant.getFullYear(), (trimestreCourant - 1) * 3, 1);
  const annee = debut.getFullYear();
  const moisDebut = debut.getMonth();
  const moisFin = moisDebut + 2;
  return { du: iso(annee, moisDebut, 1), au: iso(annee, moisFin, dernierJour(annee, moisFin)) };
}

export type ValidationPeriode = 'ok' | 'incomplete' | 'inversee';

export function validerPeriode(du: string | undefined, au: string | undefined): ValidationPeriode {
  if (!du || !au) return 'incomplete';
  // ISO aaaa-mm-jj : l'ordre lexicographique est l'ordre chronologique.
  return du <= au ? 'ok' : 'inversee';
}
