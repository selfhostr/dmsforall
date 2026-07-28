/**
 * Jeton d'injection de `ServiceAudit`. `Symbol.for`, comme `JETON_DB` : `atelier` (lecture de
 * `GET /ordres-reparation/{id}/journal`) l'obtient sans dépendre de la classe concrète. Contrat
 * gelé lot 1, §6.2 du plan d'exécution.
 */
export const JETON_AUDIT = Symbol.for('DFA_AUDIT');
