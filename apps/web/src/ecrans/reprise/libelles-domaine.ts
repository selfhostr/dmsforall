import type { DomaineReprise, MotifExclusionPlanReprise } from '@dfa/shared';

/**
 * Vocabulaire MÉTIER du plan de reprise (`DomaineReprise`) — jamais le vocabulaire technique de
 * l'analyse (`RoleTableReprise`/`TableDetecteeReprise.nomTechnique`). L'écran de validation
 * (`EtapeValidationPlan`) n'importe QUE ce fichier pour nommer un domaine, jamais un nom de table.
 */
export function cleI18nDomaine(domaine: DomaineReprise): string {
  return `reprise:domaines.${domaine}`;
}

/** Motif d'exclusion (`MotifExclusionPlanReprise`) -> clé i18n, dans le vocabulaire garagiste
 *  (« comptabilité non reprise », jamais « comptabilite_non_reprise »). */
export function cleI18nMotifExclusion(motif: MotifExclusionPlanReprise): string {
  return `reprise:plan.exclu.motif.${motif}`;
}
