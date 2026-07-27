/**
 * Jeton d'injection du service de limitation de débit.
 *
 * Injecter par jeton plutôt que par classe concrète permet à `AuthModule` de dépendre de
 * l'interface et non de l'implémentation Redis — ce qui rend le service de connexion testable
 * sans Redis, et laisse la porte ouverte à une implémentation en mémoire pour les tests
 * unitaires ou à un changement de backend sans toucher aux appelants.
 */
export const JETON_SERVICE_LIMITATION_DEBIT = Symbol.for('DFA_SERVICE_LIMITATION_DEBIT');
