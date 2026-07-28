/**
 * Jeton d'injection de `ServiceEvenements`. `Symbol.for`, comme `JETON_DB` : véhicules et atelier
 * l'obtiennent sans dépendre de la classe concrète. Contrat gelé lot 1, §6.2 du plan d'exécution.
 */
export const JETON_EVENEMENTS = Symbol.for('DFA_EVENEMENTS');
