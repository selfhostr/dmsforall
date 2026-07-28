/**
 * Jeton d'injection de `ServiceIdempotence`. `Symbol.for` (registre global du runtime) comme
 * `JETON_DB` : deux modules sans import commun (clients, véhicules, atelier) obtiennent le même
 * jeton sans dépendre de la classe concrète. Contrat gelé lot 1, §6.2 du plan d'exécution.
 */
export const JETON_IDEMPOTENCE = Symbol.for('DFA_IDEMPOTENCE');
