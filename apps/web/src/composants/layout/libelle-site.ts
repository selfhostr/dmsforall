import type { TFunction } from 'i18next';

import type { SessionCourante } from '@dfa/shared';

/**
 * Résout le libellé affiché pour le site actif — SEULE fonction qui décide du texte. Distingue à
 * la source (règle du dépôt : absence de donnée ≠ valeur) :
 *  - `site === undefined` : aucun `?site=` ET aucune préférence mémorisée — état légitime, le
 *    MÊME que le filtre « Tous les sites » du tableau de bord.
 *  - `site` défini mais inconnu de la session (lien obsolète, site supprimé) : la seule vraie
 *    absence, « Aucun site choisi ».
 *  - `site` défini et connu : son nom.
 */
export function resoudreLibelleSite(
  sites: SessionCourante['sites'] | undefined,
  site: string | undefined,
  t: TFunction,
): string {
  if (!sites) return '';
  if (site === undefined) return t('navigation:entete.tousLesSites');
  return (
    sites.find((candidat) => candidat.id === site)?.nom ?? t('navigation:entete.siteNonChoisi')
  );
}
