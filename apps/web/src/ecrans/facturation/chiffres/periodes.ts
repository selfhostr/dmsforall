export interface PeriodeIso {
  /** `aaaa-mm-jj`, borne incluse. */
  readonly du: string;
  /** `aaaa-mm-jj`, borne incluse. */
  readonly au: string;
}

export interface PeriodesChiffres {
  readonly moisCourant: PeriodeIso;
  readonly moisPrecedent: PeriodeIso;
  readonly annee: PeriodeIso;
}

const deux = (n: number) => String(n).padStart(2, '0');

function moisComplet(annee: number, mois: number): PeriodeIso {
  // Jour 0 du mois suivant = dernier jour de ce mois (calendrier UTC pur : pas de décalage de fuseau).
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return { du: `${annee}-${deux(mois)}-01`, au: `${annee}-${deux(mois)}-${deux(dernierJour)}` };
}

/**
 * Les trois fenêtres de la page : mois civil en cours, mois civil précédent (janvier -> décembre de
 * l'année d'avant) et année civile en cours. `aujourdhui` est un jour civil local `aaaa-mm-jj`.
 */
export function periodesChiffres(aujourdhui: string): PeriodesChiffres {
  const [anneeTexte, moisTexte] = aujourdhui.split('-');
  const annee = Number(anneeTexte);
  const mois = Number(moisTexte);
  const precedent = mois === 1 ? moisComplet(annee - 1, 12) : moisComplet(annee, mois - 1);
  return {
    moisCourant: moisComplet(annee, mois),
    moisPrecedent: precedent,
    annee: { du: `${annee}-01-01`, au: `${annee}-12-31` },
  };
}
