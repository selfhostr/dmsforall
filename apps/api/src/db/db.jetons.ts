/**
 * Jetons d'injection de la couche base de données.
 *
 * `Symbol.for` (et non `Symbol()`) est délibéré : le symbole est enregistré dans le registre
 * global du runtime, donc deux modules qui écrivent `Symbol.for('DFA_DB')` obtiennent
 * strictement le même jeton, même s'ils ne partagent aucun import. C'est ce qui permet de
 * découpler les modules NestJS sans faire circuler des classes concrètes.
 *
 * Contrat gelé étape 0, §2.8 — ces valeurs ne se renégocient pas.
 */

/** Jeton de `AccesBase` — fourni par `DbModule` (@Global), disponible partout. */
export const JETON_DB = Symbol.for('DFA_DB');

/**
 * Jeton de `AccesAmorcage` — fourni par `DbAmorcageModule`, qui n'est **pas** global et n'est
 * importé que par `AuthModule`. La portée restreinte est volontaire : l'amorçage travaille hors
 * contexte tenant, aucun module métier ne doit pouvoir l'injecter par accident.
 */
export const JETON_DB_AMORCAGE = Symbol.for('DFA_DB_AMORCAGE');
