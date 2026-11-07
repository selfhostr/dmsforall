import type { ReponseOrdreReparation } from '@dfa/shared';

/**
 * « Mes OR du jour » : tri et partage par site, purs (aucun appel réseau).
 *
 * Tri : restitution promise la plus proche d'abord (un retard passe donc avant une promesse du
 * jour), puis les OR SANS promesse (« aucune date » n'est jamais une urgence ni un retard — elle
 * ne se range ni en tête ni parmi les dates), puis le numéro pour un ordre stable.
 */
export function trierParEcheance(
  ordres: readonly ReponseOrdreReparation[],
): readonly ReponseOrdreReparation[] {
  return [...ordres].sort((a, b) => {
    const echeanceA = a.restitutionPromiseLe ? Date.parse(a.restitutionPromiseLe) : null;
    const echeanceB = b.restitutionPromiseLe ? Date.parse(b.restitutionPromiseLe) : null;
    if (echeanceA !== null && echeanceB !== null && echeanceA !== echeanceB) {
      return echeanceA - echeanceB;
    }
    if (echeanceA !== null && echeanceB === null) return -1;
    if (echeanceA === null && echeanceB !== null) return 1;
    return a.numero.localeCompare(b.numero, 'fr', { numeric: true });
  });
}

/**
 * Une borne ne pointe que sur SON site (le serveur refuse `POINTAGE_SITE_AUTRE` sinon) : un OR
 * d'un autre site est affiché, mais jamais proposé au pointage. `siteBorne === undefined`
 * (compte de personne, portée tenant) -> aucun OR n'est « hors site ».
 */
export function estHorsSite(
  ordre: Pick<ReponseOrdreReparation, 'siteId'>,
  siteBorne: string | undefined,
): boolean {
  return siteBorne !== undefined && ordre.siteId !== siteBorne;
}
