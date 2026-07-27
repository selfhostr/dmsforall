/**
 * Jetons d'injection du module auth (contrat gelé étape 0, §2.10).
 *
 * `Symbol.for` (registre global du runtime) plutôt que `Symbol()` : même raison que
 * `apps/api/src/db/db.jetons.ts` — deux modules qui écrivent `Symbol.for('DFA_...')` obtiennent
 * strictement le même jeton sans partager d'import, ce qui découple `AuthModule` des modules qui
 * consomment ses services.
 */

/** Jeton de `ServiceMotDePasse` — Argon2id, voir `services/mot-de-passe.service.ts`. */
export const JETON_SERVICE_MOT_DE_PASSE = Symbol.for('DFA_SERVICE_MOT_DE_PASSE');

/** Jeton de `ServiceSession` — voir `services/session.service.ts`. */
export const JETON_SERVICE_SESSION = Symbol.for('DFA_SERVICE_SESSION');
