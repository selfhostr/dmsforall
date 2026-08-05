/**
 * Jetons d'injection du module `connecteurs` — même patron que `atelier/atelier.jetons.ts`
 * (`Symbol.for`, un jeton par port).
 */

/** Port `SourceActivationsConnecteur` (`source-activations-connecteur.ts`). */
export const JETON_SOURCE_ACTIVATIONS_CONNECTEUR = Symbol.for('DFA_SOURCE_ACTIVATIONS_CONNECTEUR');

/**
 * Liste des adaptateurs déployés dans ce processus (`readonly AdaptateurConnecteur[]`,
 * `adaptateur-connecteur.ts`) — aujourd'hui uniquement les cinq factices
 * (`adaptateurs-factices/`). Un futur adaptateur réel s'ajoute à cette liste dans
 * `connecteurs.module.ts`, jamais en dur dans le registre.
 */
export const JETON_ADAPTATEURS_CONNECTEUR = Symbol.for('DFA_ADAPTATEURS_CONNECTEUR');
