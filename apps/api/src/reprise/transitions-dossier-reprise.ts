/**
 * Machine à états de `dossier_reprise` — miroir applicatif EXACT du commentaire gelé
 * `STATUTS_DOSSIER_REPRISE` (`packages/shared/src/contrats/reprise.ts`). Appliquée en TypeScript,
 * pas par un trigger SQL dédié (voir l'en-tête de la migration 0067 pour la justification) : un
 * dispositif SQLSTATE ZDFA1 à la `resiliation_tenant` (0062) n'apporterait rien de plus qu'un test
 * unitaire ne couvre déjà ici, pour un coût de migration disproportionné.
 */

import type { StatutDossierReprise } from '@dfa/shared';

/**
 * Transitions PROGRESSIVES du diagramme gelé — `annule` en est délibérément ABSENTE ici : la
 * dernière ligne du diagramme (« * (tout état non terminal) -> annule ») est un JOKER appliqué
 * séparément par `transitionAutorisee` ci-dessous, jamais dupliqué à la main dans chaque entrée —
 * une omission (constatée une fois : `depot_receptionne` avait été oubliée) resterait alors
 * invisible jusqu'à ce qu'un test l'exerce précisément.
 */
const TRANSITIONS_PROGRESSIVES: Readonly<
  Record<StatutDossierReprise, readonly StatutDossierReprise[]>
> = {
  depot_en_cours: ['depot_receptionne'],
  depot_receptionne: ['analyse_en_cours'],
  analyse_en_cours: ['analyse_terminee', 'analyse_echouee'],
  analyse_echouee: ['analyse_en_cours'],
  analyse_terminee: ['plan_propose'],
  plan_propose: ['plan_valide'],
  plan_valide: ['import_en_cours'],
  import_en_cours: ['import_termine', 'import_echoue'],
  import_echoue: ['import_en_cours'],
  import_termine: [],
  annule: [],
};

const STATUTS_TERMINAUX: readonly StatutDossierReprise[] = ['import_termine', 'annule'];

export function transitionAutorisee(
  depuis: StatutDossierReprise,
  vers: StatutDossierReprise,
): boolean {
  if (vers === 'annule') return !STATUTS_TERMINAUX.includes(depuis);
  return TRANSITIONS_PROGRESSIVES[depuis].includes(vers);
}

/** États depuis lesquels `POST .../annuler` est recevable — tout état NON terminal (contrat). */
export function annulationRecevable(depuis: StatutDossierReprise): boolean {
  return transitionAutorisee(depuis, 'annule');
}
